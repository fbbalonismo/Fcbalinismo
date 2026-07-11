import { NextRequest, NextResponse } from "next/server";
import { fetchForecast } from "@/lib/openmeteo";
import { MODELS } from "@/lib/config";
import { saveText, listJson } from "@/lib/store";
import { RAIN_RANGES, type RainStatus } from "@/lib/rain/scale";

// Registro de chuva observada na base + placar de realismo dos modelos.
// Cada registro guarda um snapshot do que os 3 modelos previam para aquela
// hora, então o placar não depende de histórico da API.

export const dynamic = "force-dynamic";

// "aproximacao" é um registro de alerta (nuvem chegando), não uma medida de mm
// no solo — é aceito e guardado, mas não entra na pontuação do placar.
function isValidStatus(s: unknown): s is RainStatus {
  return s === "aproximacao" || (typeof s === "string" && s in RAIN_RANGES);
}

interface RainRecord {
  time: string; // hora local registrada
  intensity: RainStatus;
  predicted: Record<string, number | null>; // label do modelo -> mm/h previsto
  lat?: number;
  lon?: number;
}

function nowLocalHour(): string {
  // Pedra Azul é UTC-3 fixo
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 13) + ":00";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const intensity = body?.intensity;
    if (!isValidStatus(intensity)) {
      return NextResponse.json({ error: "Intensidade inválida" }, { status: 400 });
    }
    const lat = typeof body?.lat === "number" ? body.lat : undefined;
    const lon = typeof body?.lon === "number" ? body.lon : undefined;

    const time = nowLocalHour();
    // Snapshot da previsão dos modelos — na localização informada (ou na base).
    const forecast = await fetchForecast(
      lat != null && lon != null ? { lat, lon, name: "Local do alerta" } : undefined
    );
    const predicted: Record<string, number | null> = {};
    for (const m of MODELS) {
      const hour = forecast.models[m.id]?.hours.find((h) => h.time === time);
      predicted[m.label] = hour?.precipMm ?? null;
    }

    const record: RainRecord = { time, intensity, predicted, lat, lon };
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
      const range = RAIN_RANGES[r.intensity as keyof typeof RAIN_RANGES];
      if (!range) continue; // pula "aproximacao" (não é medida de mm no solo)
      const [lo, hi] = range;
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
