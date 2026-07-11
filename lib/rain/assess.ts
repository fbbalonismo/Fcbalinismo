import { rainSeverity, type RainLevel, type RainStatus } from "./scale";
import type { RainAssessment, SourceReading } from "./types";
import { openMeteoNowcast } from "./openmeteo";
import { rainViewerNowcast, rainViewerRadarTile } from "./rainviewer";
import { accuWeatherNowcast } from "./providers";

const APPROACH_WINDOW_MIN = 60; // "aproximação" só alerta se a chuva chega em até 1h

// Consulta todas as fontes disponíveis para um ponto e combina numa avaliação.
export async function assessRain(lat: number, lon: number): Promise<RainAssessment> {
  const [openMeteo, rainViewer, accu, radar] = await Promise.all([
    openMeteoNowcast(lat, lon),
    rainViewerNowcast(lat, lon),
    accuWeatherNowcast(lat, lon),
    rainViewerRadarTile(),
  ]);

  const sources: SourceReading[] = [openMeteo, rainViewer, accu];
  const usable = sources.filter((s) => s.ok);

  // 1) Alguma fonte diz que chove agora? → status = maior intensidade observada.
  const raining = usable.filter((s) => s.rainingNow);
  let status: RainStatus = "sem";
  let mmNow: number | null = null;
  let etaMin: number | null = null;

  if (raining.length) {
    const levels = raining.map((s) => s.level).filter((l): l is RainLevel => l != null);
    status = levels.length
      ? levels.reduce((a, b) => (rainSeverity(b) > rainSeverity(a) ? b : a))
      : "leve";
    const mms = raining.map((s) => s.mmNow).filter((m): m is number => m != null);
    mmNow = mms.length ? Math.max(...mms) : null;
  } else {
    // 2) Ninguém chovendo, mas alguma fonte vê nuvem chegando em breve.
    const approaching = usable
      .map((s) => s.etaMin)
      .filter((e): e is number => e != null && e <= APPROACH_WINDOW_MIN);
    if (approaching.length) {
      status = "aproximacao";
      etaMin = Math.min(...approaching);
    }
  }

  return {
    lat,
    lon,
    checkedAt: new Date().toISOString(),
    status,
    raining: raining.length > 0,
    approaching: status === "aproximacao",
    mmNow,
    etaMin,
    sources,
    radar,
  };
}
