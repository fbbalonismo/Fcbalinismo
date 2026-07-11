import type { SourceReading } from "./types";

// Conector de app pago/registro. Sem a chave no ambiente, retorna
// `configured: false` (não atrapalha o alerta). Com a chave, faz a chamada real.
// Basta definir a env var e a fonte entra automaticamente na avaliação.

// ---------------------------------------------------------------------------
// AccuWeather — MinuteCast dá a chuva minuto a minuto (ideal para "chegada").
// Requer ACCUWEATHER_API_KEY. O MinuteCast aceita lat,lon direto no `q` (não
// precisa de geoposition → 1 chamada só). Como o tier free é ~50 chamadas/dia,
// a resposta é cacheada por 30 min (revalidate) para o polling não estourar.
// https://developer.accuweather.com/
// ---------------------------------------------------------------------------
const ACCU_CACHE_S = 1800; // 30 min entre chamadas reais à AccuWeather

export async function accuWeatherNowcast(lat: number, lon: number): Promise<SourceReading> {
  const base: SourceReading = {
    source: "AccuWeather",
    ok: false,
    configured: false,
    rainingNow: false,
    mmNow: null,
    level: null,
    etaMin: null,
  };
  const key = process.env.ACCUWEATHER_API_KEY;
  if (!key) return { ...base, note: "sem ACCUWEATHER_API_KEY" };
  try {
    // arredonda o ponto (~1 km) para maximizar o cache entre chamadas próximas
    const q = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const mc = await fetch(
      `https://dataservice.accuweather.com/forecasts/v1/minute?apikey=${key}&q=${q}`,
      { next: { revalidate: ACCU_CACHE_S } }
    );
    if (!mc.ok) return { ...base, configured: true, note: `minutecast HTTP ${mc.status}` };
    const data = await mc.json();
    // Summary.Type: null (sem chuva) ou "RAIN"/"SNOW"; Intervals[].Minute = min até o evento
    const summary = data?.Summary?.Type ?? null;
    const intervals: { Minute: number; Dbz: number }[] = data?.Intervals ?? [];
    const rainingNow = (intervals[0]?.Dbz ?? 0) > 0;
    let etaMin: number | null = null;
    if (!rainingNow) {
      const first = intervals.find((i) => (i.Dbz ?? 0) > 0);
      if (first) etaMin = first.Minute;
    }
    return {
      ...base,
      ok: true,
      configured: true,
      rainingNow,
      // detector de presença/aproximação; intensidade em mm fica com Open-Meteo
      level: rainingNow ? "leve" : null,
      etaMin,
      note: summary ? `MinuteCast: ${summary}` : "sem chuva no MinuteCast",
    };
  } catch (e) {
    return { ...base, configured: true, note: e instanceof Error ? e.message : "erro" };
  }
}
