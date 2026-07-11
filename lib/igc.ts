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

  const pts: TrackPoint[] = [];
  let prevSecs = -1;
  let dayOffset = 0;

  for (const l of lines) {
    if (l[0] !== "B" || l.length < 35) continue;

    const hh = +l.slice(1, 3);
    const mm = +l.slice(3, 5);
    const ss = +l.slice(5, 7);

    const latDeg = +l.slice(7, 9);
    const latMin = +l.slice(9, 11) + +l.slice(11, 14) / 1000;
    const latHem = l[14];
    const lonDeg = +l.slice(15, 18);
    const lonMin = +l.slice(18, 20) + +l.slice(20, 23) / 1000;
    const lonHem = l[23];

    const pressAlt = +l.slice(25, 30);
    const gnssAlt = +l.slice(30, 35);

    let lat = latDeg + latMin / 60;
    if (latHem === "S") lat = -lat;
    let lon = lonDeg + lonMin / 60;
    if (lonHem === "W") lon = -lon;

    // Prefere altitude GNSS; cai para barométrica se a GNSS vier zerada/inválida
    const ele = Number.isFinite(gnssAlt) && gnssAlt !== 0 ? gnssAlt : pressAlt;

    // Tempo absoluto (trata virada de meia-noite, embora raro em balão)
    const secs = hh * 3600 + mm * 60 + ss;
    if (prevSecs >= 0 && secs < prevSecs) dayOffset++;
    prevSecs = secs;
    const t = dayEpoch + secs + dayOffset * 86400;

    if ([lat, lon, ele, t].every(Number.isFinite)) pts.push({ lat, lon, ele, t });
  }

  if (pts.length < 30) {
    throw new Error(`IGC com poucos pontos de trilha (${pts.length}) — exporte o voo completo`);
  }
  return pts;
}
