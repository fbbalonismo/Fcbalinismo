import { BASE, MODELS, PRESSURE_LEVELS, TIMEZONE, type ModelId } from "./config";
import { interpolateLayers, driftPath, type LevelPoint, type LayerWind, type DriftPoint } from "./wind";

export interface HourForecast {
  time: string; // ISO local (America/Sao_Paulo), ex: 2026-07-09T06:00
  surface: { kt: number; from: number; to: number } | null;
  gustKt: number | null;
  tempC: number | null;
  precipMm: number | null;
  // Sinais de nevoeiro / névoa baixa (para alerta na condição de decolagem)
  weatherCode: number | null; // WMO: 45 = nevoeiro, 48 = nevoeiro com geada
  visibilityM: number | null; // visibilidade horizontal (m)
  cloudLowPct: number | null; // cobertura de nuvem baixa (%) — 0 a ~3 km
  cloudMidPct: number | null; // cobertura de nuvem média (%) — ~3 a 8 km
  cloudHighPct: number | null; // cobertura de nuvem alta (%) — acima de ~8 km
  rhPct: number | null; // umidade relativa a 2 m (%)
  dewC: number | null; // ponto de orvalho a 2 m (°C)
  capeJkg: number | null; // energia potencial convectiva (J/kg) — instabilidade/tempestade
  pressureHpa: number | null; // pressão à superfície (hPa) — altitude-densidade
  layers: LayerWind[];
  drift: DriftPoint[];
}

// Local de decolagem (padrão: base Voe Pedra Azul)
export interface Loc {
  lat: number;
  lon: number;
  name?: string;
  elevation?: number; // se omitido, a API usa a elevação do terreno (DEM)
}

export interface ForecastResponse {
  elevation: number;
  updatedAt: string;
  base: { lat: number; lon: number; name: string };
  sunrise: Record<string, string>; // data (YYYY-MM-DD) -> hora local (HH:MM)
  sunset: Record<string, string>;
  models: Record<ModelId, { hours: HourForecast[] }>;
}

type Hourly = Record<string, (number | null)[] | string[]>;

function buildUrl(loc: Loc): string {
  const vars: string[] = [
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "temperature_2m",
    "precipitation",
    "weather_code",
    "visibility",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "relative_humidity_2m",
    "dew_point_2m",
    "cape",
    "surface_pressure",
  ];
  for (const p of PRESSURE_LEVELS) {
    vars.push(`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`);
  }
  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: vars.join(","),
    daily: "sunrise,sunset",
    models: MODELS.map((m) => m.id).join(","),
    timezone: TIMEZONE,
    wind_speed_unit: "kn",
    forecast_days: "4",
    past_days: "2", // permite analisar GPX enviado até 2 dias depois do voo
  });
  if (loc.elevation != null) params.set("elevation", String(loc.elevation));
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function num(hourly: Hourly, key: string, i: number): number | null {
  const arr = hourly[key] as (number | null)[] | undefined;
  const v = arr?.[i];
  return typeof v === "number" ? v : null;
}

export async function fetchForecast(customLoc?: Loc): Promise<ForecastResponse> {
  const loc: Loc = customLoc ?? { lat: BASE.lat, lon: BASE.lon, name: BASE.name, elevation: BASE.elevation };
  const res = await fetch(buildUrl(loc), { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
  const data = await res.json();
  const hourly: Hourly = data.hourly;
  const elevation: number = data.elevation;
  const times = hourly.time as string[];

  // Nascer/pôr do sol vêm sufixados por modelo, mas são iguais em todos — usa o primeiro disponível
  const daily = data.daily ?? {};
  const dailyTimes = (daily.time as string[]) ?? [];
  const readDaily = (prefix: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const key = Object.keys(daily).find((k) => k.startsWith(prefix));
    if (key) {
      dailyTimes.forEach((date: string, i: number) => {
        const iso = (daily[key] as string[])[i];
        if (iso) out[date] = iso.slice(11, 16);
      });
    }
    return out;
  };
  const sunrise = readDaily("sunrise");
  const sunset = readDaily("sunset");

  const models = {} as ForecastResponse["models"];

  for (const model of MODELS) {
    const hours: HourForecast[] = times.map((time, i) => {
      const profile: LevelPoint[] = [];

      const sfcKt = num(hourly, `wind_speed_10m_${model.id}`, i);
      const sfcDir = num(hourly, `wind_direction_10m_${model.id}`, i);
      if (sfcKt !== null && sfcDir !== null) {
        profile.push({ heightAgl: 10, speedKt: sfcKt, dirFrom: sfcDir });
      }

      for (const p of PRESSURE_LEVELS) {
        const kt = num(hourly, `wind_speed_${p}hPa_${model.id}`, i);
        const dir = num(hourly, `wind_direction_${p}hPa_${model.id}`, i);
        const gph = num(hourly, `geopotential_height_${p}hPa_${model.id}`, i);
        if (kt === null || dir === null || gph === null) continue;
        const heightAgl = gph - elevation;
        if (heightAgl < 20) continue; // nível abaixo do solo (base a ~1200 m)
        profile.push({ heightAgl, speedKt: kt, dirFrom: dir });
      }

      const gust = num(hourly, `wind_gusts_10m_${model.id}`, i);
      const temp = num(hourly, `temperature_2m_${model.id}`, i);
      const precip = num(hourly, `precipitation_${model.id}`, i);
      const wcode = num(hourly, `weather_code_${model.id}`, i);
      const vis = num(hourly, `visibility_${model.id}`, i);
      const cloudLow = num(hourly, `cloud_cover_low_${model.id}`, i);
      const cloudMid = num(hourly, `cloud_cover_mid_${model.id}`, i);
      const cloudHigh = num(hourly, `cloud_cover_high_${model.id}`, i);
      const rh = num(hourly, `relative_humidity_2m_${model.id}`, i);
      const dew = num(hourly, `dew_point_2m_${model.id}`, i);
      const cape = num(hourly, `cape_${model.id}`, i);
      const pressure = num(hourly, `surface_pressure_${model.id}`, i);
      const layers = interpolateLayers(profile);
      return {
        time,
        gustKt: gust !== null ? Math.round(gust * 10) / 10 : null,
        tempC: temp !== null ? Math.round(temp) : null,
        precipMm: precip !== null ? Math.round(precip * 100) / 100 : null,
        weatherCode: wcode !== null ? Math.round(wcode) : null,
        visibilityM: vis !== null ? Math.round(vis) : null,
        cloudLowPct: cloudLow !== null ? Math.round(cloudLow) : null,
        cloudMidPct: cloudMid !== null ? Math.round(cloudMid) : null,
        cloudHighPct: cloudHigh !== null ? Math.round(cloudHigh) : null,
        rhPct: rh !== null ? Math.round(rh) : null,
        dewC: dew !== null ? Math.round(dew * 10) / 10 : null,
        capeJkg: cape !== null ? Math.round(cape) : null,
        pressureHpa: pressure !== null ? Math.round(pressure * 10) / 10 : null,
        surface:
          sfcKt !== null && sfcDir !== null
            ? { kt: Math.round(sfcKt * 10) / 10, from: Math.round(sfcDir), to: Math.round((sfcDir + 180) % 360) }
            : null,
        layers,
        drift: layers.length ? driftPath(layers, loc) : [],
      };
    });

    models[model.id] = { hours: hours.filter((h) => h.layers.length > 0) };
  }

  return {
    elevation,
    updatedAt: new Date().toISOString(),
    base: { lat: loc.lat, lon: loc.lon, name: loc.name ?? "Local personalizado" },
    sunrise,
    sunset,
    models,
  };
}
