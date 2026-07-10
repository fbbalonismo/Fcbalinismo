"use client";

import { Fragment, useEffect } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-rotate";

// Opções do plugin leaflet-rotate (girar o mapa com dois dedos / botão bússola)
const ROTATE_OPTIONS = {
  rotate: true,
  touchRotate: true,
  rotateControl: { closeOnZeroBearing: false },
} as Record<string, unknown>;
import { BASE, REFERENCES } from "@/lib/config";
import type { DriftPoint } from "@/lib/wind";

const DEG = Math.PI / 180;

export interface MapOrigin {
  lat: number;
  lon: number;
  name: string;
}

function pointAtBearing(origin: MapOrigin, bearing: number, distM: number): [number, number] {
  const lat = origin.lat + (distM * Math.cos(bearing * DEG)) / 111_320;
  const lon = origin.lon + (distM * Math.sin(bearing * DEG)) / (111_320 * Math.cos(origin.lat * DEG));
  return [lat, lon];
}

function labelIcon(html: string, className: string) {
  return L.divIcon({ html, className, iconSize: undefined });
}

export interface DriftSeries {
  label: string;
  color: string;
  drift: DriftPoint[];
}

// Reenquadra o mapa para conter a base e todas as trajetórias.
// ResizeObserver corrige o tamanho medido pelo Leaflet quando o layout
// termina depois do mount (fontes, grid) — sem isso os tiles ficam deslocados.
function FitDrift({ series, origin }: { series: DriftSeries[]; origin: MapOrigin }) {
  const map = useMap();
  // Assinatura estável: só reenquadra quando a trajetória de fato muda
  const sig =
    `${origin.lat},${origin.lon}|` +
    series.map((s) => `${s.label}:${s.drift.at(-1)?.lat ?? 0},${s.drift.at(-1)?.lon ?? 0}`).join("|");
  useEffect(() => {
    const fit = () => {
      const el = map.getContainer();
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      const pts: [number, number][] = [[origin.lat, origin.lon]];
      for (const s of series) for (const p of s.drift) pts.push([p.lat, p.lon]);
      map.invalidateSize({ animate: false });
      map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 14, animate: false });
    };
    fit();
    const t = setTimeout(fit, 150);
    const ro = new ResizeObserver(fit);
    ro.observe(map.getContainer());
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sig]);
  return null;
}

export default function DriftMap({
  series,
  activeLabel,
  fullscreen = false,
  origin = { lat: BASE.lat, lon: BASE.lon, name: "Base Voe Pedra Azul" },
  showRefs = true,
}: {
  series: DriftSeries[];
  activeLabel?: string;
  fullscreen?: boolean;
  origin?: MapOrigin;
  showRefs?: boolean;
}) {
  const refDist = 2600; // metros até o rótulo de referência

  return (
    <MapContainer
      center={[origin.lat, origin.lon]}
      zoom={13}
      scrollWheelZoom={fullscreen}
      style={{ height: "100%", width: "100%" }}
      attributionControl={false}
      {...ROTATE_OPTIONS}
    >
      <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
      <FitDrift series={series} origin={origin} />

      {/* Linhas de azimute e rótulos das referências (só na base de Pedra Azul) */}
      {showRefs && REFERENCES.map((ref) => {
        const end = pointAtBearing(origin, ref.bearing, refDist);
        return (
          <Fragment key={ref.bearing}>
            <Polyline
              positions={[[BASE.lat, BASE.lon], end]}
              pathOptions={{ color: "#ffffff", weight: 1.2, opacity: 0.55, dashArray: "6 6" }}
            />
            <Marker
              position={end}
              icon={labelIcon(
                `<div class="ref-label"><b>${ref.bearing}°</b><br/>${ref.name}</div>`,
                "ref-label-wrap"
              )}
            />
          </Fragment>
        );
      })}

      {/* Ponto de decolagem */}
      <CircleMarker
        center={[origin.lat, origin.lon]}
        radius={7}
        pathOptions={{ color: "#fff", weight: 2, fillColor: "#e11d48", fillOpacity: 1 }}
      >
        <Tooltip direction="bottom" offset={[0, 8]} permanent className="base-tooltip">
          {origin.name}
        </Tooltip>
      </CircleMarker>

      {/* Trajetórias de deriva (modelo ativo em destaque, demais tracejados) */}
      {series.map((s) => {
        const active = !activeLabel || s.label === activeLabel;
        return (
          <Fragment key={s.label}>
            <Polyline
              positions={s.drift.map((p) => [p.lat, p.lon])}
              pathOptions={{
                color: s.color,
                weight: active ? 4 : 2.5,
                opacity: active ? 0.95 : 0.5,
                dashArray: active ? undefined : "6 7",
              }}
            />
            {s.drift.slice(1).map((p, i) => (
              <CircleMarker
                key={i}
                center={[p.lat, p.lon]}
                radius={active ? 4 : 2.5}
                pathOptions={{
                  color: "#fff",
                  weight: active ? 1.5 : 0.8,
                  fillColor: s.color,
                  fillOpacity: active ? 1 : 0.5,
                }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  {s.label} · {p.m} m · {(p.kt * 1.852).toFixed(0)} km/h → {p.to}°
                </Tooltip>
              </CircleMarker>
            ))}
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
