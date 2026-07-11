import { NextRequest, NextResponse } from "next/server";
import { fetchForecast } from "@/lib/openmeteo";
import { analyzeFlight, parseGpx, type FlightAnalysis, type TrackPoint } from "@/lib/gpx";
import { parseKml } from "@/lib/kml";
import { parseIgc } from "@/lib/igc";
import { extractKmlFromKmz } from "@/lib/kmz";
import { saveText, listJson } from "@/lib/store";

// Upload público de trilha de voo (GPX do Wikiloc, KML/KMZ do HotAir ou IGC do
// Kubicek Flymate): guarda o arquivo original e roda a análise padronizada
// (bandas de 100 m × previsão dos 3 modelos), acumulando o histórico
// de validação automaticamente.

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
    const name = file.name.toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    // KMZ é um ZIP (assinatura "PK\x03\x04") — extrai o KML interno.
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    let text: string;
    try {
      text = name.endsWith(".kmz") || isZip ? extractKmlFromKmz(buf) : buf.toString("utf8");
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Não consegui abrir o arquivo" },
        { status: 400 }
      );
    }

    const isKml = /<kml[\s>]/i.test(text) || name.endsWith(".kml") || name.endsWith(".kmz") || isZip;
    const isGpx = text.includes("<gpx");
    // IGC: extensão .igc ou registros B (padrão FAI) num arquivo texto sem XML
    const isIgc = !isKml && !isGpx && (name.endsWith(".igc") || /^B\d{6}/m.test(text));
    if (!isGpx && !isKml && !isIgc) {
      return NextResponse.json(
        { error: "Formato não reconhecido — envie GPX (Wikiloc), KML/KMZ (HotAir) ou IGC (Kubicek Flymate)" },
        { status: 400 }
      );
    }
    const ext = isKml ? "kml" : isIgc ? "igc" : "gpx";
    const contentType = isKml
      ? "application/vnd.google-earth.kml+xml"
      : isIgc
        ? "application/octet-stream"
        : "application/gpx+xml";

    // Analisa no local real da decolagem (1º ponto da trilha) — funciona em
    // qualquer lugar, não só na base de Pedra Azul
    let analysis: FlightAnalysis;
    try {
      const pts: TrackPoint[] = isKml ? parseKml(text) : isIgc ? parseIgc(text) : parseGpx(text);
      const origin = pts[0];
      const forecast = await fetchForecast({ lat: origin.lat, lon: origin.lon, name: "Local do voo" });
      analysis = analyzeFlight(pts, file.name, forecast, origin.ele);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : `Não consegui analisar este ${ext.toUpperCase()}` },
        { status: 422 }
      );
    }

    const noModels = Object.keys(analysis.models).length === 0;
    const stamp = analysis.startLocal.replace(/:/g, "h");

    await saveText(`voos/${stamp}.${ext}`, text, contentType);
    await saveText(`voos/${stamp}.json`, JSON.stringify(analysis), "application/json");

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
    const flights = await listJson<FlightAnalysis>("voos/");

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
