import { CLIMB_RATE_MS, LAYERS_M } from "./config";

// Conversão para exibição: internamente tudo é calculado em nós (kt)
export function ktToKmh(kt: number): number {
  return Math.round(kt * 1.852 * 10) / 10;
}

export interface LevelPoint {
  heightAgl: number; // m acima do solo
  speedKt: number;
  dirFrom: number; // direção meteorológica (de onde vem)
}

export interface LayerWind {
  m: number;
  ft: number;
  from: number; // de onde vem
  to: number; // para onde vai
  kt: number;
}

export interface DriftPoint {
  lat: number;
  lon: number;
  m: number; // altitude AGL ao passar por este ponto
  to: number; // rumo da deriva nesta camada
  kt: number;
}

const DEG = Math.PI / 180;

// Direção meteorológica (de onde o vento vem) -> componentes u (leste) e v (norte)
function toUV(speedKt: number, dirFrom: number): [number, number] {
  const u = -speedKt * Math.sin(dirFrom * DEG);
  const v = -speedKt * Math.cos(dirFrom * DEG);
  return [u, v];
}

function fromUV(u: number, v: number): { speedKt: number; dirFrom: number } {
  const speedKt = Math.hypot(u, v);
  let dirFrom = (Math.atan2(-u, -v) / DEG + 360) % 360;
  if (speedKt < 0.05) dirFrom = 0;
  return { speedKt, dirFrom };
}

/**
 * Interpola o perfil de vento (pontos ordenados por altura AGL) para as
 * camadas-alvo de LAYERS_M, interpolando linearmente em u/v.
 */
export function interpolateLayers(profile: LevelPoint[]): LayerWind[] {
  const pts = profile
    .filter((p) => Number.isFinite(p.speedKt) && Number.isFinite(p.dirFrom))
    .sort((a, b) => a.heightAgl - b.heightAgl);
  if (pts.length === 0) return [];

  const uv = pts.map((p) => ({ h: p.heightAgl, uv: toUV(p.speedKt, p.dirFrom) }));

  return LAYERS_M.map((m) => {
    let u: number, v: number;
    if (m <= uv[0].h) {
      [u, v] = uv[0].uv;
    } else if (m >= uv[uv.length - 1].h) {
      [u, v] = uv[uv.length - 1].uv;
    } else {
      let i = 0;
      while (uv[i + 1].h < m) i++;
      const a = uv[i], b = uv[i + 1];
      const t = (m - a.h) / (b.h - a.h);
      u = a.uv[0] + t * (b.uv[0] - a.uv[0]);
      v = a.uv[1] + t * (b.uv[1] - a.uv[1]);
    }
    const { speedKt, dirFrom } = fromUV(u, v);
    return {
      m,
      ft: Math.round(m * 3.28084),
      from: Math.round(dirFrom),
      to: Math.round((dirFrom + 180) % 360),
      kt: Math.round(speedKt * 10) / 10,
    };
  });
}

/**
 * Trajetória de deriva prevista: o balão sobe a CLIMB_RATE_MS constante
 * e é levado pelo vento de cada camada. Retorna a polyline a partir da origem.
 */
export function driftPath(layers: LayerWind[], origin: { lat: number; lon: number }): DriftPoint[] {
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos(origin.lat * DEG);
  const KT_TO_MS = 0.514444;

  let lat = origin.lat;
  let lon = origin.lon;
  let prevTop = 0;
  const path: DriftPoint[] = [{ lat, lon, m: 0, to: layers[0]?.to ?? 0, kt: layers[0]?.kt ?? 0 }];

  for (const layer of layers) {
    const thickness = layer.m - prevTop;
    prevTop = layer.m;
    const seconds = thickness / CLIMB_RATE_MS;
    const dist = layer.kt * KT_TO_MS * seconds; // metros
    const dx = dist * Math.sin(layer.to * DEG); // leste
    const dy = dist * Math.cos(layer.to * DEG); // norte
    lat += dy / mPerDegLat;
    lon += dx / mPerDegLon;
    path.push({ lat, lon, m: layer.m, to: layer.to, kt: layer.kt });
  }
  return path;
}

export function cardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return dirs[Math.round(deg / 22.5) % 16];
}
