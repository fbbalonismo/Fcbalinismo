import { BASE, MODELS, PRESSURE_LEVELS, TIMEZONE, type ModelId } from "./config";
import { interpolateLayers, driftPath, type LevelPoint, type LayerWind, type DriftPoint } from "./wind";

export interface HourForecast {
  time: string; // ISO local (America/Sao_Paulo), ex: 2026-07-09T06:00
  surface: { kt: number; from: number; to: number } | null;
  layers: LayerWind[];
  drift: DriftPoint[];
}

export interface ForecastResponse {
  elevation: number;
  updatedAt: string;
  base: { lat: number; lon: number; name: string };
  models: Record<ModelId, { hours: HourForecast[] }>;
}

type Hourly = Record<string, (number | null)[] | string[]>;

function buildUrl(): string {
  const vars: string[] = ["wind_speed_10m", "wind_direction_10m"];
  for (const p of PRESSURE_LEVELS) {
    vars.push(`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`);
  }
  const params = new URLSearchParams({
    latitude: String(BASE.lat),
    longitude: String(BASE.lon),
    elevation: String(BASE.elevation),
    hourly: vars.join(","),
    models: MODELS.map((m) => m.id).join(","),
    timezone: TIMEZONE,
    wind_speed_unit: "kn",
    forecast_days: "4",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function num(hourly: Hourly, key: string, i: number): number | null {
  const arr = hourly[key] as (number | null)[] | undefined;
  const v = arr?.[i];
  return typeof v === "number" ? v : null;
}

export async function fetchForecast(): Promise<ForecastResponse> {
  const res = await fetch(buildUrl(), { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
  const data = await res.json();
  const hourly: Hourly = data.hourly;
  const elevation: number = data.elevation;
  const times = hourly.time as string[];

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

      const layers = interpolateLayers(profile);
      return {
        time,
        surface:
          sfcKt !== null && sfcDir !== null
            ? { kt: Math.round(sfcKt * 10) / 10, from: Math.round(sfcDir), to: Math.round((sfcDir + 180) % 360) }
            : null,
        layers,
        drift: layers.length ? driftPath(layers) : [],
      };
    });

    models[model.id] = { hours: hours.filter((h) => h.layers.length > 0) };
  }

  return {
    elevation,
    updatedAt: new Date().toISOString(),
    base: { lat: BASE.lat, lon: BASE.lon, name: BASE.name },
    models,
  };
}
