import { NextRequest, NextResponse } from "next/server";
import { list, put } from "@vercel/blob";
import { fetchForecast } from "@/lib/openmeteo";
import { analyzeFlight, parseGpx, type FlightAnalysis } from "@/lib/gpx";

// Upload público de GPX de voo: guarda o arquivo original no Blob e roda a
// análise padronizada (bandas de 100 m × previsão dos 3 modelos), acumulando
// o histórico de validação automaticamente.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie um arquivo .gpx" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Arquivo muito grande (máx. 15 MB)" }, { status: 400 });
    }
    const xml = await file.text();
    if (!xml.includes("<gpx")) {
      return NextResponse.json({ error: "O arquivo não parece ser um GPX" }, { status: 400 });
    }

    // Analisa no local real da decolagem (1º ponto do GPX) — funciona em
    // qualquer lugar, não só na base de Pedra Azul
    let analysis: FlightAnalysis;
    try {
      const pts = parseGpx(xml);
      const origin = pts[0];
      const forecast = await fetchForecast({ lat: origin.lat, lon: origin.lon, name: "Local do voo" });
      analysis = analyzeFlight(pts, file.name, forecast, origin.ele);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Não consegui analisar este GPX" },
        { status: 422 }
      );
    }

    const noModels = Object.keys(analysis.models).length === 0;
    const stamp = analysis.startLocal.replace(/:/g, "h");

    await put(`voos/${stamp}.gpx`, xml, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/gpx+xml",
    });
    await put(`voos/${stamp}.json`, JSON.stringify(analysis), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });

    return NextResponse.json({
      ok: true,
      analysis,
      aviso: noModels
        ? "GPX salvo, mas a previsão desta data já saiu do alcance da comparação (envie até 2 dias após o voo para ter a análise completa)."
        : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro no upload" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const { blobs } = await list({ prefix: "voos/", limit: 1000 });
    const flights: FlightAnalysis[] = (
      await Promise.all(
        blobs
          .filter((b) => b.pathname.endsWith(".json"))
          .map(async (b) => {
            try {
              return (await (await fetch(b.url)).json()) as FlightAnalysis;
            } catch {
              return null;
            }
          })
      )
    ).filter((f): f is FlightAnalysis => f !== null);

    flights.sort((a, b) => (a.startLocal < b.startLocal ? 1 : -1));

    // Média acumulada por modelo (voos com análise completa)
    const media: Record<string, { dirErr: number; speedBias: number; voos: number }> = {};
    for (const f of flights) {
      for (const [label, s] of Object.entries(f.models)) {
        const acc = media[label] ?? { dirErr: 0, speedBias: 0, voos: 0 };
        acc.dirErr += s.meanDirErr;
        acc.speedBias += s.speedBiasKt;
        acc.voos++;
        media[label] = acc;
      }
    }
    for (const label of Object.keys(media)) {
      media[label].dirErr = Math.round((media[label].dirErr / media[label].voos) * 10) / 10;
      media[label].speedBias = Math.round((media[label].speedBias / media[label].voos) * 10) / 10;
    }

    return NextResponse.json({ flights: flights.slice(0, 20), totalVoos: flights.length, media });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao listar" },
      { status: 500 }
    );
  }
}
