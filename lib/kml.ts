import { XMLParser } from "fast-xml-parser";
import type { TrackPoint } from "./gpx";

// Parser de KML (ex.: exportação do app HotAir) para o mesmo formato de trilha
// usado na análise pós-voo (TrackPoint com lat/lon/ele/tempo). Suporta:
//   1. <gx:Track> — pares <when> + <gx:coord "lon lat ele"> (tempo por ponto).
//   2. <LineString> + <TimeSpan> — coordenadas sem tempo, com início/fim; o
//      tempo é distribuído linearmente entre os pontos.
// A análise precisa de tempo por ponto (para velocidade/direção por faixa), por
// isso um LineString sem qualquer referência de tempo é recusado com instrução.

interface RawTrack {
  when: string[];
  coord: string[];
}

// Percorre recursivamente a árvore e coleta todo nó que tenha <when> + <coord>
// (um gx:Track), independente de estar dentro de Placemark/Folder/Document.
function collectTracks(node: unknown, out: RawTrack[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectTracks(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.when != null && obj.coord != null) {
    out.push({
      when: (Array.isArray(obj.when) ? obj.when : [obj.when]).map(String),
      coord: (Array.isArray(obj.coord) ? obj.coord : [obj.coord]).map(String),
    });
  }
  for (const key of Object.keys(obj)) {
    if (key === "when" || key === "coord") continue;
    collectTracks(obj[key], out);
  }
}

// Coleta LineStrings (coordenadas "lon,lat,ele" separadas por espaço) junto do
// TimeSpan begin/end mais próximo no mesmo Placemark.
interface RawLine {
  coordinates: string;
  begin?: string;
  end?: string;
}
function collectLines(node: unknown, out: RawLine[], span?: { begin?: string; end?: string }): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectLines(item, out, span);
    return;
  }
  const obj = node as Record<string, unknown>;
  // TimeSpan deste nível passa a valer para os filhos
  const ts = obj.TimeSpan as Record<string, unknown> | undefined;
  const here = ts
    ? { begin: ts.begin != null ? String(ts.begin) : undefined, end: ts.end != null ? String(ts.end) : undefined }
    : span;
  const ls = obj.LineString as Record<string, unknown> | undefined;
  if (ls?.coordinates != null) {
    out.push({ coordinates: String(ls.coordinates), begin: here?.begin, end: here?.end });
  }
  for (const key of Object.keys(obj)) collectLines(obj[key], out, here);
}

export function parseKml(xml: string): TrackPoint[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true, // "gx:Track" -> "Track", "gx:coord" -> "coord"
    trimValues: true,
  });
  const doc = parser.parse(xml);
  if (!doc.kml) throw new Error("Arquivo não parece ser um KML válido");

  const pts: TrackPoint[] = [];

  // 1) gx:Track (tempo por ponto)
  const tracks: RawTrack[] = [];
  collectTracks(doc.kml, tracks);
  for (const trk of tracks) {
    const n = Math.min(trk.when.length, trk.coord.length);
    for (let i = 0; i < n; i++) {
      // gx:coord é "longitude latitude altitude"
      const [lon, lat, ele] = trk.coord[i].trim().split(/\s+/).map(Number);
      const t = Date.parse(trk.when[i]) / 1000;
      if ([lat, lon, ele, t].every(Number.isFinite)) pts.push({ lat, lon, ele, t });
    }
  }

  // 2) LineString + TimeSpan (tempo interpolado linearmente)
  if (pts.length === 0) {
    const lines: RawLine[] = [];
    collectLines(doc.kml, lines);
    for (const ln of lines) {
      const tuples = ln.coordinates.trim().split(/\s+/).filter(Boolean);
      if (tuples.length < 2) continue;
      const t0 = ln.begin ? Date.parse(ln.begin) / 1000 : NaN;
      const t1 = ln.end ? Date.parse(ln.end) / 1000 : NaN;
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
      const step = (t1 - t0) / (tuples.length - 1);
      tuples.forEach((tuple, i) => {
        const [lon, lat, ele] = tuple.split(",").map(Number);
        const t = t0 + step * i;
        if ([lat, lon, ele, t].every(Number.isFinite)) pts.push({ lat, lon, ele, t });
      });
    }
  }

  if (pts.length === 0) {
    throw new Error(
      "KML sem trilha com horário. No HotAir, exporte a trilha completa do voo (com registro de tempo) em KML."
    );
  }
  if (pts.length < 30) {
    throw new Error(`KML com poucos pontos de trilha (${pts.length}) — exporte a trilha completa`);
  }
  // Garante ordem cronológica (alguns exports não vêm ordenados)
  pts.sort((a, b) => a.t - b.t);
  return pts;
}
