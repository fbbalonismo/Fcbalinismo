import { PNG } from "pngjs";
import type { SourceReading } from "./types";

// RainViewer: radar real + nowcast (extrapolação do radar 0–30 min à frente),
// grátis e sem chave. Amostra o pixel do radar exatamente no ponto para dizer
// se há eco de chuva agora e, pelos frames de nowcast, em quantos minutos uma
// nuvem de chuva chega ao ponto ("aproximação").

const Z = 9; // zoom da tile (~150 m/pixel nesta latitude) — bom compromisso
const TILE = 256;
const COLOR = 4; // esquema de cores do RainViewer (Universal Blue)
const ECHO_ALPHA = 20; // alpha mínimo p/ contar como eco (ignora suavização de borda)

interface Frame {
  time: number; // epoch (s)
  path: string;
}
interface Maps {
  host: string;
  radar: { past: Frame[]; nowcast: Frame[] };
}

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}
function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

// Baixa a tile do frame e devolve o alpha (0–255) do pixel do ponto.
// alpha > 0 = há eco de radar (chuva) naquele ponto.
async function sampleAlpha(host: string, frame: Frame, lat: number, lon: number): Promise<number> {
  const xf = lonToTileX(lon, Z);
  const yf = latToTileY(lat, Z);
  const tileX = Math.floor(xf);
  const tileY = Math.floor(yf);
  const px = Math.min(TILE - 1, Math.max(0, Math.floor((xf - tileX) * TILE)));
  const py = Math.min(TILE - 1, Math.max(0, Math.floor((yf - tileY) * TILE)));

  const url = `${host}${frame.path}/${TILE}/${Z}/${tileX}/${tileY}/${COLOR}/1_1.png`;
  const res = await fetch(url, { next: { revalidate: 120 } });
  if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  const idx = (py * png.width + px) * 4;
  return png.data[idx + 3] ?? 0;
}

export async function rainViewerNowcast(lat: number, lon: number): Promise<SourceReading> {
  const base: SourceReading = {
    source: "RainViewer",
    ok: false,
    configured: true,
    rainingNow: false,
    mmNow: null,
    level: null,
    etaMin: null,
  };
  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
      next: { revalidate: 120 },
    });
    if (!res.ok) return { ...base, note: `maps HTTP ${res.status}` };
    const maps: Maps = await res.json();
    const past = maps.radar?.past ?? [];
    const nowcast = maps.radar?.nowcast ?? [];
    const current = past[past.length - 1];
    if (!current) return { ...base, note: "sem frame de radar" };

    // Eco no ponto agora?
    const alphaNow = await sampleAlpha(maps.host, current, lat, lon);
    const rainingNow = alphaNow > ECHO_ALPHA;

    // Se não chove agora, varre os frames de nowcast (futuro) pelo primeiro com
    // eco no ponto → ETA de chegada da nuvem.
    let etaMin: number | null = null;
    if (!rainingNow && nowcast.length) {
      const nowMs = Date.now();
      for (const f of nowcast) {
        const a = await sampleAlpha(maps.host, f, lat, lon);
        if (a > ECHO_ALPHA) {
          etaMin = Math.max(0, Math.round((f.time * 1000 - nowMs) / 60000));
          break;
        }
      }
    }

    return {
      ...base,
      ok: true,
      rainingNow,
      // O RainViewer é usado como detector de presença/aproximação; a
      // intensidade em mm fica por conta do Open-Meteo (mais quantitativo).
      level: rainingNow ? "leve" : null,
      etaMin,
      note: rainingNow ? "eco de radar no ponto" : etaMin != null ? `nuvem chega em ~${etaMin} min` : undefined,
    };
  } catch (e) {
    return { ...base, note: e instanceof Error ? e.message : "erro" };
  }
}

// URL da tile de radar mais recente, para o cliente sobrepor no mapa.
export async function rainViewerRadarTile(): Promise<{ tileUrl: string; frameTime: number } | null> {
  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
      next: { revalidate: 120 },
    });
    if (!res.ok) return null;
    const maps: Maps = await res.json();
    const past = maps.radar?.past ?? [];
    const current = past[past.length - 1];
    if (!current) return null;
    // Template {z}/{x}/{y} para o Leaflet TileLayer.
    return {
      tileUrl: `${maps.host}${current.path}/${TILE}/{z}/{x}/{y}/${COLOR}/1_1.png`,
      frameTime: current.time,
    };
  } catch {
    return null;
  }
}
