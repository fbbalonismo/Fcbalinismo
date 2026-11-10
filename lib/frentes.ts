// Monitor de frente fria com as estações automáticas do INMET.
//
// Ideia: no ES a frente fria chega do quadrante sul/sudoeste. Olhamos estações
// "a montante" (entre SSE e ONO da base) e procuramos a assinatura clássica
// no Hemisfério Sul: pressão caindo + vento de N/NO antes; vento virando para
// S/SO + queda de temperatura + pressão subindo na passagem e depois.

export const FRONT_KMH = 30; // velocidade típica de deslocamento de frente fria
export const RAIO_KM = 550; // até onde procurar estações
export const UPSTREAM_MIN = 150; // rumo base→estação (graus) considerado "a montante"
export const UPSTREAM_MAX = 300;

export interface EstacaoInmet {
  CD_ESTACAO: string;
  DC_NOME: string;
  SG_ESTADO: string;
  VL_LATITUDE: string | number;
  VL_LONGITUDE: string | number;
  CD_SITUACAO?: string;
  TP_ESTACAO?: string;
}

export interface Ponto {
  utcMs: number;
  pressaoHpa: number | null;
  tempC: number | null;
  umidade: number | null;
  ventoKmh: number | null;
  ventoDir: number | null; // de onde o vento vem (graus)
  rajadaKmh: number | null;
}

export type Fase = "sem_dados" | "normal" | "pre" | "passagem" | "pos";

export interface Analise {
  fase: Fase;
  last: Ponto | null;
  tendP3h: number | null;
  quedaTemp3h: number | null;
  giroVento: boolean;
  idadeMin: number | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

export function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function rumo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toR = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toR) * Math.cos(lat2 * toR);
  const x = Math.cos(lat1 * toR) * Math.sin(lat2 * toR) - Math.sin(lat1 * toR) * Math.cos(lat2 * toR) * Math.cos((lon2 - lon1) * toR);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface Candidata {
  e: EstacaoInmet;
  lat: number;
  lon: number;
  d: number; // km
  b: number; // rumo base→estação
}

// Escolhe a estação mais próxima (referência local) + até `nUp` estações a
// montante, espaçadas em distância para "ver" a frente vindo de longe.
export function escolheEstacoes(lista: EstacaoInmet[], lat: number, lon: number, nUp = 6): Candidata[] {
  const cands: Candidata[] = [];
  for (const e of lista) {
    if (e.TP_ESTACAO && !/autom/i.test(e.TP_ESTACAO)) continue;
    if (e.CD_SITUACAO && !/operante/i.test(e.CD_SITUACAO)) continue;
    const la = num(e.VL_LATITUDE);
    const lo = num(e.VL_LONGITUDE);
    if (la == null || lo == null) continue;
    const d = distanciaKm(lat, lon, la, lo);
    if (d > RAIO_KM) continue;
    cands.push({ e, lat: la, lon: lo, d, b: rumo(lat, lon, la, lo) });
  }
  cands.sort((a, b) => a.d - b.d);
  const out: Candidata[] = [];
  if (cands[0]) out.push(cands[0]);
  const up = cands.filter((c) => c.b >= UPSTREAM_MIN && c.b <= UPSTREAM_MAX && c !== cands[0]);
  // espaçamento mínimo entre estações escolhidas, para cobrir 0–550 km
  const passo = RAIO_KM / (nUp + 1);
  let ultimaD = -Infinity;
  for (const c of up) {
    if (out.length > nUp) break;
    if (c.d - ultimaD < passo * 0.6) continue;
    out.push(c);
    ultimaD = c.d;
  }
  return out.sort((a, b) => a.d - b.d);
}

// Registro horário do INMET (horário em UTC, vento em m/s).
export function parseSerie(raw: unknown): Ponto[] {
  if (!Array.isArray(raw)) return [];
  const out: Ponto[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const dt = String(r.DT_MEDICAO ?? "");
    const hr = String(r.HR_MEDICAO ?? "").padStart(4, "0");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || !/^\d{4}$/.test(hr)) continue;
    const utcMs = Date.parse(`${dt}T${hr.slice(0, 2)}:${hr.slice(2)}:00Z`);
    if (!Number.isFinite(utcMs)) continue;
    const vel = num(r.VEN_VEL);
    const raj = num(r.VEN_RAJ);
    const dir = num(r.VEN_DIR);
    out.push({
      utcMs,
      pressaoHpa: num(r.PRE_INS),
      tempC: num(r.TEM_INS),
      umidade: num(r.UMD_INS),
      ventoKmh: vel != null ? Math.round(vel * 3.6) : null,
      ventoDir: dir != null && dir >= 0 && dir <= 360 ? dir % 360 : null,
      rajadaKmh: raj != null ? Math.round(raj * 3.6) : null,
    });
  }
  return out.sort((a, b) => a.utcMs - b.utcMs);
}

// valor da variável mais perto de `alvoMs` (tolerância 90 min)
function perto(serie: Ponto[], alvoMs: number, k: keyof Ponto): number | null {
  let best: number | null = null;
  let bestDt = 90 * 60000;
  for (const p of serie) {
    const v = p[k];
    if (v == null) continue;
    const dt = Math.abs(p.utcMs - alvoMs);
    if (dt <= bestDt) {
      best = v;
      bestDt = dt;
    }
  }
  return best;
}

const doNorte = (d: number) => d >= 290 || d <= 60; // N, NO, NE
const doSul = (d: number) => d >= 130 && d <= 250; // SE, S, SO

export function analisa(serie: Ponto[], agoraMs = Date.now()): Analise {
  const validos = serie.filter((p) => p.pressaoHpa != null || p.tempC != null);
  const last = validos.at(-1) ?? null;
  if (!last) return { fase: "sem_dados", last: null, tendP3h: null, quedaTemp3h: null, giroVento: false, idadeMin: null };

  const t0 = last.utcMs;
  const p0 = last.pressaoHpa;
  const p3 = perto(serie, t0 - 3 * 3600e3, "pressaoHpa");
  const tendP3h = p0 != null && p3 != null ? r1(p0 - p3) : null;

  // maior temperatura nas últimas 3 h menos a atual (positivo = esfriou)
  const temps = serie.filter((p) => p.tempC != null && p.utcMs >= t0 - 3 * 3600e3 && p.utcMs <= t0).map((p) => p.tempC!);
  const quedaTemp3h = last.tempC != null && temps.length ? r1(Math.max(...temps) - last.tempC) : null;

  // vento: o mais recente com direção e o de ~6 h antes
  const comVento = serie.filter((p) => p.ventoDir != null && p.ventoKmh != null && p.ventoKmh >= 4);
  const vAgora = comVento.at(-1);
  const vAntes = vAgora ? perto(comVento, vAgora.utcMs - 6 * 3600e3, "ventoDir") : null;
  const giroVento = vAgora != null && vAntes != null && doNorte(vAntes) && doSul(vAgora.ventoDir!);
  const sulAgora = vAgora != null && doSul(vAgora.ventoDir!);
  const norteAgora = vAgora != null && doNorte(vAgora.ventoDir!);

  let fase: Fase = "normal";
  if (giroVento || (sulAgora && (quedaTemp3h ?? 0) >= 3)) fase = "passagem";
  else if (sulAgora && (tendP3h ?? 0) >= 1) fase = "pos";
  else if ((tendP3h ?? 0) <= -1 && norteAgora) fase = "pre";

  return {
    fase,
    last,
    tendP3h,
    quedaTemp3h,
    giroVento,
    idadeMin: Math.max(0, Math.round((agoraMs - t0) / 60000)),
  };
}

// leitura mais recente que tem vento (velocidade + direção) — o último
// registro do INMET às vezes vem sem vento
export function ultimoVento(serie: Ponto[]): Ponto | null {
  return [...serie].reverse().find((p) => p.ventoKmh != null && p.ventoDir != null) ?? null;
}
