import { NextRequest, NextResponse } from "next/server";
import { saveText, listJson } from "@/lib/store";

// Importa registros de chuva de um app anterior (cola o JSON de /api/chuva).
// Regrava cada registro como chuva/<time>.json, no formato que o GET lê.
// Additivo e idempotente por horário — não apaga nada.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RecordLike {
  time?: unknown;
  intensity?: unknown;
  predicted?: unknown;
  lat?: unknown;
  lon?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body?.confirm !== "voe-import") {
      return NextResponse.json({ error: "Confirmação ausente" }, { status: 400 });
    }
    const raw = Array.isArray(body?.records) ? body.records : Array.isArray(body?.data?.records) ? body.data.records : null;
    if (!raw) {
      return NextResponse.json({ error: "Cole o JSON de /api/chuva (precisa ter 'records')." }, { status: 400 });
    }

    const existing = await listJson<{ time: string }>("chuva/");
    const seen = new Set(existing.map((r) => r.time));

    let importados = 0;
    let pulados = 0;
    for (const r of raw as RecordLike[]) {
      if (typeof r?.time !== "string" || typeof r?.intensity !== "string") {
        pulados++;
        continue;
      }
      if (seen.has(r.time)) {
        pulados++;
        continue;
      }
      const rec: RecordLike = {
        time: r.time,
        intensity: r.intensity,
        predicted: r.predicted ?? {},
        ...(typeof r.lat === "number" ? { lat: r.lat } : {}),
        ...(typeof r.lon === "number" ? { lon: r.lon } : {}),
      };
      await saveText(`chuva/${r.time.replace(":", "h")}.json`, JSON.stringify(rec), "application/json");
      seen.add(r.time);
      importados++;
    }

    return NextResponse.json({ ok: true, importados, pulados, totalAgora: seen.size });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao importar" }, { status: 500 });
  }
}
