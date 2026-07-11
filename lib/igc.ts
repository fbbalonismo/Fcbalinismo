import type { TrackPoint } from "./gpx";

// Parser de IGC (padrão FAI de gravadores de voo) — formato exportado por
// instrumentos de balão como o Kubicek Flymate. Transpõe os registros B para o
// mesmo formato de trilha usado na análise (TrackPoint: lat/lon/ele/tempo).
//
// Registro B (colunas 1-based):
//   B HHMMSS DDMMmmm N DDDMMmmm E A PPPPP GGGGG
//   1 2..7   8..15      16..24     25 26..30 31..35
// Latitude  = DD graus + MMmmm minutos (mmm = milésimos de minuto), hemisfério N/S.
// Longitude = DDD graus + MMmmm minutos, hemisfério E/W.
// PPPPP = altitude barométrica, GGGGG = altitude GNSS (usamos a GNSS quando válida).
// A data vem do cabeçalho HFDTE (DDMMYY); o tempo dos B-records é UTC do dia.

function parseHeaderDate(lines: string[]): { y: number; m: number; d: number } | null {
  for (const l of lines) {
    if (!l.startsWith("HFDTE")) continue;
    // Aceita "HFDTE100726" e "HFDTEDATE:100726,01"
    const m = l.match(/(\d{2})(\d{2})(\d{2})/);
    if (m) return { d: +m[1], m: +m[2], y: 2000 + +m[3] };
  }
  return null;
}

export function parseIgc(text: string): TrackPoint[] {
  const lines = text.split(/\r?\n/);
  const date = parseHeaderDate(lines);
  if (!date) {
    throw new Error("IGC sem data no cabeçalho (HFDTE) — arquivo incompleto");
  }
  const dayEpoch = Date.UTC(date.y, date.m - 1, date.d, 0, 0, 0) / 1000;

  // 1ª passada: lê os registros B guardando as DUAS altitudes (GNSS e
  // barométrica) separadamente. 0 é o valor-sentinela de "não gravado" no IGC.
  interface Raw {
    lat: number;
    lon: number;
    t: number;
    gnss: number | null;
    press: number | null;
  }
  const raw: Raw[] = [];
  let prevSecs = -1;
  let dayOffset = 0;

  for (const l of lines) {
    // Coordenadas + altitude barométrica ocupam até a coluna 30; a GNSS (30–35)
    // é opcional em alguns gravadores, então basta length >= 30.
    if (l[0] !== "B" || l.length < 30) continue;

    const hh = +l.slice(1, 3);
    const mm = +l.slice(3, 5);
    const ss = +l.slice(5, 7);

    const latDeg = +l.slice(7, 9);
    const latMin = +l.slice(9, 11) + +l.slice(11, 14) / 1000;
    const latHem = l[14];
    const lonDeg = +l.slice(15, 18);
    const lonMin = +l.slice(18, 20) + +l.slice(20, 23) / 1000;
    const lonHem = l[23];

    const pressRaw = +l.slice(25, 30);
    const gnssRaw = l.length >= 35 ? +l.slice(30, 35) : NaN;
    const press = Number.isFinite(pressRaw) && pressRaw !== 0 ? pressRaw : null;
    const gnss = Number.isFinite(gnssRaw) && gnssRaw !== 0 ? gnssRaw : null;

    let lat = latDeg + latMin / 60;
    if (latHem === "S") lat = -lat;
    let lon = lonDeg + lonMin / 60;
    if (lonHem === "W") lon = -lon;

    // Tempo absoluto (trata virada de meia-noite, embora raro em balão)
    const secs = hh * 3600 + mm * 60 + ss;
    if (prevSecs >= 0 && secs < prevSecs) dayOffset++;
    prevSecs = secs;
    const t = dayEpoch + secs + dayOffset * 86400;

    if ([lat, lon, t].every(Number.isFinite)) raw.push({ lat, lon, t, gnss, press });
  }

  // Escolhe UMA fonte de altitude para todo o voo (não mistura datums GPS e
  // barométrico). Prefere GNSS — o procedimento define AGL pela elevação GPS;
  // só usa barométrica se a maioria dos pontos não tiver GNSS.
  const gnssCount = raw.filter((r) => r.gnss != null).length;
  const useGnss = gnssCount >= raw.length / 2;

  const pts: TrackPoint[] = [];
  for (const r of raw) {
    const ele = useGnss ? r.gnss : r.press;
    if (ele != null) pts.push({ lat: r.lat, lon: r.lon, ele, t: r.t });
  }
  pts.sort((a, b) => a.t - b.t); // garante ordem cronológica

  if (pts.length < 30) {
    throw new Error(`IGC com poucos pontos de trilha (${pts.length}) — exporte o voo completo`);
  }
  return pts;
}
