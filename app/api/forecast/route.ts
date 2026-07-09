import { NextResponse } from "next/server";
import { fetchForecast } from "@/lib/openmeteo";

export const revalidate = 1800;

export async function GET() {
  try {
    const forecast = await fetchForecast();
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
