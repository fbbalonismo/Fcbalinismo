import { NextRequest, NextResponse } from "next/server";
import { saveText, listJson } from "@/lib/store";

// Importa voos analisados de um app anterior (cola o JSON de /api/voos).
// Regrava cada voo como voos/<stamp>.json, no mesmo formato que o GET lê.
// Additivo e idempotente por horário de início — não apaga nada.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FlightLike {
  startLocal?: unknown;
  models?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body?.confirm !== "voe-import") {
      return NextResponse.json({ error: "Confirmação ausente" }, { status: 400 });
    }
    const raw = Array.isArray(body?.flights) ? body.flights : Array.isArray(body?.data?.flights) ? body.data.flights : null;
    if (!raw) {
      return NextResponse.json({ error: "Cole o JSON de /api/voos (precisa ter 'flights')." }, { status: 400 });
    }

    const existing = await listJson<{ startLocal: string }>("voos/");
    const seen = new Set(existing.map((f) => f.startLocal));

    let importados = 0;
    let pulados = 0;
    for (const f of raw as FlightLike[]) {
      if (typeof f?.startLocal !== "string") {
        pulados++;
        continue;
      }
      if (seen.has(f.startLocal)) {
        pulados++;
        continue;
      }
      const stamp = f.startLocal.replace(/:/g, "h");
      await saveText(`voos/${stamp}.json`, JSON.stringify(f), "application/json");
      seen.add(f.startLocal);
      importados++;
    }

    return NextResponse.json({ ok: true, importados, pulados, totalAgora: seen.size });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao importar" }, { status: 500 });
  }
}
