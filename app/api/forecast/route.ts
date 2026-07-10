import { NextRequest, NextResponse } from "next/server";
import { fetchForecast, type Loc } from "@/lib/openmeteo";

export const revalidate = 1800;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const lat = parseFloat(sp.get("lat") ?? "");
    const lon = parseFloat(sp.get("lon") ?? "");
    let loc: Loc | undefined;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      // Arredonda para melhorar o reuso de cache entre pontos próximos
      loc = {
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lon * 10000) / 10000,
        name: (sp.get("name") ?? "").slice(0, 80) || "Local personalizado",
      };
    }
    const forecast = await fetchForecast(loc);
    return NextResponse.json(forecast, {
      headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao buscar previsão" },
      { status: 502 }
    );
  }
}
