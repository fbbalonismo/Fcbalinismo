import { classifyMm, isRaining } from "./scale";
import type { SourceReading } from "./types";

// Nowcast quantitativo via Open-Meteo (grátis, sem chave). Usa a precipitação
// dos próximos 15-em-15 min para dizer se chove agora e, se não, em quantos
// minutos deve começar. mm por 15 min → mm/h multiplicando por 4.

const ONSET_MM_PER_H = 0.1; // limiar para considerar "chuva começando"

export async function openMeteoNowcast(lat: number, lon: number): Promise<SourceReading> {
  const base: SourceReading = {
    source: "Open-Meteo",
    ok: false,
    configured: true,
    rainingNow: false,
    mmNow: null,
    level: null,
    etaMin: null,
  };
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      minutely_15: "precipitation",
      current: "precipitation",
      forecast_days: "1",
      timezone: "auto",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return { ...base, note: `HTTP ${res.status}` };
    const data = await res.json();

    const times: string[] = data.minutely_15?.time ?? [];
    const precip: (number | null)[] = data.minutely_15?.precipitation ?? [];
    if (times.length === 0) return { ...base, note: "sem minutely_15" };

    // Índice do slot que cobre "agora": último slot cujo horário já passou.
    const nowMs = Date.now();
    let nowIdx = 0;
    for (let i = 0; i < times.length; i++) {
      // horários vêm no fuso local (timezone=auto) sem TZ explícito
      if (new Date(times[i]).getTime() <= nowMs) nowIdx = i;
      else break;
    }

    const rate = (v: number | null | undefined) => (typeof v === "number" ? v * 4 : 0); // mm/15min → mm/h
    const mmNow = rate(precip[nowIdx]);
    const level = classifyMm(mmNow);
    const rainingNow = isRaining(level);

    // Se não chove agora, procura o próximo slot com chuva para estimar o ETA.
    let etaMin: number | null = null;
    if (!rainingNow) {
      for (let i = nowIdx + 1; i < times.length; i++) {
        if (rate(precip[i]) >= ONSET_MM_PER_H) {
          etaMin = Math.max(0, Math.round((new Date(times[i]).getTime() - nowMs) / 60000));
          break;
        }
      }
    }

    return {
      ...base,
      ok: true,
      rainingNow,
      mmNow: Math.round(mmNow * 100) / 100,
      level,
      etaMin,
    };
  } catch (e) {
    return { ...base, note: e instanceof Error ? e.message : "erro" };
  }
}
