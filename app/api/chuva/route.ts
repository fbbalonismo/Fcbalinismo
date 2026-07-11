import { NextRequest, NextResponse } from "next/server";
import { fetchForecast } from "@/lib/openmeteo";
import { MODELS } from "@/lib/config";
import { saveText, listJson } from "@/lib/store";

// Registro de chuva observada na base + placar de realismo dos modelos.
// Cada registro guarda um snapshot do que os 3 modelos previam para aquela
// hora, então o placar não depende de histórico da API.

export const dynamic = "force-dynamic";

export type Intensity = "sem" | "leve" | "moderada" | "intensa";

// Faixas de precipitação horária (mm/h) correspondentes a cada intensidade
const RANGES: Record<Intensity, [number, number]> = {
  sem: [0, 0.2],
  leve: [0.2, 2.5],
  moderada: [2.5, 10],
  intensa: [10, Infinity],
};

interface RainRecord {
  time: string; // hora local registrada
  intensity: Intensity;
  predicted: Record<string, number | null>; // label do modelo -> mm/h previsto
}

function nowLocalHour(): string {
  // Pedra Azul é UTC-3 fixo
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 13) + ":00";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const intensity = body?.intensity as Intensity;
    if (!RANGES[intensity]) {
      return NextResponse.json({ error: "Intensidade inválida" }, { status: 400 });
    }

    const time = nowLocalHour();
    const forecast = await fetchForecast();
    const predicted: Record<string, number | null> = {};
    for (const m of MODELS) {
      const hour = forecast.models[m.id]?.hours.find((h) => h.time === time);
      predicted[m.label] = hour?.precipMm ?? null;
    }

    const record: RainRecord = { time, intensity, predicted };
    await saveText(
      `chuva/${time.replace(":", "h")}.json`,
      JSON.stringify(record),
      "application/json"
    );
    return NextResponse.json({ ok: true, record });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao registrar" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const records = await listJson<RainRecord>("chuva/");

    records.sort((a, b) => (a.time < b.time ? 1 : -1));

    // Placar: modelo acerta quando o mm previsto cai na faixa da intensidade observada
    const placar: Record<string, { acertos: number; total: number }> = {};
    for (const m of MODELS) placar[m.label] = { acertos: 0, total: 0 };
    for (const r of records) {
      const [lo, hi] = RANGES[r.intensity] ?? [0, 0];
      for (const m of MODELS) {
        const mm = r.predicted?.[m.label];
        if (mm === null || mm === undefined) continue;
        placar[m.label].total++;
        if (mm >= lo && mm < hi) placar[m.label].acertos++;
      }
    }

    return NextResponse.json({ records: records.slice(0, 30), totalRegistros: records.length, placar });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao listar" },
      { status: 500 }
    );
  }
}
