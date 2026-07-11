import { NextRequest, NextResponse } from "next/server";
import { assessRain } from "@/lib/rain/assess";
import { BASE } from "@/lib/config";

// Nowcast de chuva para um ponto: combina RainViewer + Open-Meteo (+ Climatempo/
// AccuWeather quando houver chave) e diz se chove agora, a intensidade e se há
// nuvem de chuva se aproximando (com ETA em minutos).

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const lat = parseFloat(sp.get("lat") ?? "");
    const lon = parseFloat(sp.get("lon") ?? "");
    const useLat = Number.isFinite(lat) ? lat : BASE.lat;
    const useLon = Number.isFinite(lon) ? lon : BASE.lon;

    const assessment = await assessRain(useLat, useLon);
    return NextResponse.json(assessment);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro no nowcast" },
      { status: 500 }
    );
  }
}
