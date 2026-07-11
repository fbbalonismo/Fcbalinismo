import { XMLParser } from "fast-xml-parser";
import { MODELS } from "./config";
import type { ForecastResponse } from "./openmeteo";

// Análise pós-voo de um GPX (Wikiloc etc.) contra a previsão dos 3 modelos.
// Segue o procedimento padronizado do projeto (ver AGENTS.md, "Fluxo pós-voo"):
// bandas de 100 m AGL, deslocamento vetorial por banda, erro de direção e viés
// de velocidade por modelo.

const DEG = Math.PI / 180;
const KT = 0.514444;

export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number;
  t: number; // epoch segundos (UTC)
}

export interface BandResult {
  band: number; // base da faixa em m AGL (ex.: 300 = 300–400 m)
  to: number; // rumo real (para onde foi)
  kt: number;
  minutes: number;
}

export interface ModelScore {
  meanDirErr: number;
  maxDirErr: number;
  speedBiasKt: number; // previsto − real (negativo = modelo subestimou)
  bands: number;
}

export interface FlightAnalysis {
  fileName: string;
  lat?: number; // local de decolagem (1º ponto do GPX)
  lon?: number;
  baseElevM?: number;
  startLocal: string; // ISO local America/Sao_Paulo
  endLocal: string;
  forecastHour: string; // hora da previsão usada na comparação
  maxAglM: number;
  distanceKm: number;
  points: number;
  bands: BandResult[];
  models: Record<string, ModelScore>;
  bestDirection: string | null;
  bestSpeed: string | null;
}

function angErr(a: number, b: number): number {
  const e = Math.abs(a - b) % 360;
  return Math.min(e, 360 - e);
}

// Pedra Azul é UTC-3 fixo (sem horário de verão)
function toLocalISO(epoch: number): string {
  return new Date((epoch - 3 * 3600) * 1000).toISOString().slice(0, 16);
}

export function parseGpx(xml: string): TrackPoint[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);
  const gpx = doc.gpx;
  if (!gpx) throw new Error("Arquivo não parece ser um GPX válido");

  const tracks = Array.isArray(gpx.trk) ? gpx.trk : gpx.trk ? [gpx.trk] : [];
  const pts: TrackPoint[] = [];
  let withCoords = 0; // pontos com lat/lon/ele válidos (com ou sem tempo)
  let withTime = 0; // desses, quantos têm timestamp
  for (const trk of tracks) {
    const segs = Array.isArray(trk.trkseg) ? trk.trkseg : trk.trkseg ? [trk.trkseg] : [];
    for (const seg of segs) {
      const trkpts = Array.isArray(seg.trkpt) ? seg.trkpt : seg.trkpt ? [seg.trkpt] : [];
      for (const p of trkpts) {
        const lat = parseFloat(p["@_lat"]);
        const lon = parseFloat(p["@_lon"]);
        const ele = parseFloat(p.ele);
        const time = p.time ? Date.parse(p.time) / 1000 : NaN;
        if (![lat, lon, ele].every(Number.isFinite)) continue;
        withCoords++;
        if (!Number.isFinite(time)) continue;
        withTime++;
        pts.push({ lat, lon, ele, t: time });
      }
    }
  }
  if (pts.length < 30) {
    // Diferencia "trilha sem horário" de "trilha curta" para um aviso útil
    if (withCoords >= 30 && withTime < withCoords / 2) {
      throw new Error(
        "Trilha sem horário: os pontos não têm timestamp (<time>). A análise precisa do tempo de cada ponto — exporte a trilha incluindo os horários."
      );
    }
    throw new Error(`GPX com poucos pontos de trilha (${pts.length}) — exporte a trilha completa`);
  }
  pts.sort((a, b) => a.t - b.t); // garante ordem cronológica (analyzeFlight assume isso)
  return pts;
}

// Limite de dt entre pontos: descarta gaps reais (balão parado / perda de sinal)
// sem rejeitar trilhas amostradas em intervalos maiores (loggers a 60–120 s).
// Adapta-se à cadência da trilha: 3× o intervalo mediano, entre 60 s e 10 min.
function maxSegmentSeconds(pts: TrackPoint[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].t - pts[i - 1].t;
    if (d > 0) deltas.push(d);
  }
  if (!deltas.length) return 60;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return Math.min(600, Math.max(60, median * 3));
}

export function analyzeFlight(
  pts: TrackPoint[],
  fileName: string,
  forecast: ForecastResponse,
  baseElev: number
): FlightAnalysis {

  // Bandas de 100 m AGL: soma deslocamento vetorial e tempo
  const maxDt = maxSegmentSeconds(pts);
  const bands = new Map<number, { dx: number; dy: number; dt: number }>();
  let maxAgl = 0;
  let distM = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dt = b.t - a.t;
    if (dt <= 0 || dt > maxDt) continue;
    const agl = (a.ele + b.ele) / 2 - baseElev;
    maxAgl = Math.max(maxAgl, b.ele - baseElev);
    const dy = (b.lat - a.lat) * 111_320;
    const dx = (b.lon - a.lon) * 111_320 * Math.cos(a.lat * DEG);
    distM += Math.hypot(dx, dy);
    if (agl < 50) continue; // solo / decolagem
    const key = Math.floor(agl / 100) * 100;
    const acc = bands.get(key) ?? { dx: 0, dy: 0, dt: 0 };
    acc.dx += dx;
    acc.dy += dy;
    acc.dt += dt;
    bands.set(key, acc);
  }

  const bandResults: BandResult[] = [...bands.entries()]
    .map(([band, { dx, dy, dt }]) => ({
      band,
      to: Math.round(((Math.atan2(dx, dy) / DEG) % 360 + 360) % 360),
      kt: Math.round((Math.hypot(dx, dy) / dt / KT) * 10) / 10,
      minutes: Math.round((dt / 60) * 10) / 10,
    }))
    .filter((b) => b.minutes >= 0.5 && b.kt >= 2) // descarta balão parado/quase parado
    .sort((a, b) => a.band - b.band);

  if (bandResults.length < 3) {
    throw new Error("Trilha sem voo detectável (poucas faixas de altitude com deslocamento)");
  }

  // Hora da previsão: meio do voo, arredondado para a hora local
  const startLocal = toLocalISO(pts[0].t);
  const endLocal = toLocalISO(pts[pts.length - 1].t);
  const mid = (pts[0].t + pts[pts.length - 1].t) / 2;
  const forecastHour = toLocalISO(Math.round(mid / 3600) * 3600).slice(0, 13) + ":00";

  const models: Record<string, ModelScore> = {};
  for (const m of MODELS) {
    const hour = forecast.models[m.id]?.hours.find((h) => h.time === forecastHour);
    if (!hour || hour.layers.length === 0) continue;
    const errs: number[] = [];
    const biases: number[] = [];
    for (const b of bandResults) {
      const mid_alt = b.band + 50;
      const layer = hour.layers.reduce((best, l) => (Math.abs(l.m - mid_alt) < Math.abs(best.m - mid_alt) ? l : best));
      errs.push(angErr(layer.to, b.to));
      biases.push(layer.kt - b.kt);
    }
    models[m.label] = {
      meanDirErr: Math.round((errs.reduce((a, e) => a + e, 0) / errs.length) * 10) / 10,
      maxDirErr: Math.round(Math.max(...errs)),
      speedBiasKt: Math.round((biases.reduce((a, e) => a + e, 0) / biases.length) * 10) / 10,
      bands: errs.length,
    };
  }

  const entries = Object.entries(models);
  const bestDirection = entries.length
    ? entries.reduce((a, b) => (b[1].meanDirErr < a[1].meanDirErr ? b : a))[0]
    : null;
  const bestSpeed = entries.length
    ? entries.reduce((a, b) => (Math.abs(b[1].speedBiasKt) < Math.abs(a[1].speedBiasKt) ? b : a))[0]
    : null;

  return {
    fileName,
    lat: Math.round(pts[0].lat * 10000) / 10000,
    lon: Math.round(pts[0].lon * 10000) / 10000,
    baseElevM: Math.round(baseElev),
    startLocal,
    endLocal,
    forecastHour,
    maxAglM: Math.round(maxAgl),
    distanceKm: Math.round(distM / 100) / 10,
    points: pts.length,
    bands: bandResults,
    models,
    bestDirection,
    bestSpeed,
  };
}
