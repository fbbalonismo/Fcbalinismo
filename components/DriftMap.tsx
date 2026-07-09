"use client";

import { Fragment, useEffect } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASE, REFERENCES } from "@/lib/config";
import type { DriftPoint } from "@/lib/wind";

const DEG = Math.PI / 180;

function pointAtBearing(bearing: number, distM: number): [number, number] {
  const lat = BASE.lat + (distM * Math.cos(bearing * DEG)) / 111_320;
  const lon = BASE.lon + (distM * Math.sin(bearing * DEG)) / (111_320 * Math.cos(BASE.lat * DEG));
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

// Reenquadra o mapa para conter a base e todas as trajetórias
function FitDrift({ series }: { series: DriftSeries[] }) {
  const map = useMap();
  // Assinatura estável: só reenquadra quando a trajetória de fato muda
  const sig = series.map((s) => `${s.label}:${s.drift.at(-1)?.lat ?? 0},${s.drift.at(-1)?.lon ?? 0}`).join("|");
  useEffect(() => {
    const pts: [number, number][] = [[BASE.lat, BASE.lon]];
    for (const s of series) for (const p of s.drift) pts.push([p.lat, p.lon]);
    const bounds = L.latLngBounds(pts).pad(0.35);
    // Aguarda o container ter tamanho medido antes de enquadrar
    const t = setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { maxZoom: 14 });
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sig]);
  return null;
}

export default function DriftMap({ series }: { series: DriftSeries[] }) {
  const refDist = 2600; // metros até o rótulo de referência

  return (
    <MapContainer
      center={[BASE.lat, BASE.lon]}
      zoom={13}
      scrollWheelZoom={false}
      style={{ height: "100%", width: "100%" }}
      attributionControl={false}
    >
      <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
      <FitDrift series={series} />

      {/* Linhas de azimute e rótulos das referências */}
      {REFERENCES.map((ref) => {
        const end = pointAtBearing(ref.bearing, refDist);
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

      {/* Base */}
      <CircleMarker
        center={[BASE.lat, BASE.lon]}
        radius={7}
        pathOptions={{ color: "#fff", weight: 2, fillColor: "#e11d48", fillOpacity: 1 }}
      >
        <Tooltip direction="bottom" offset={[0, 8]} permanent className="base-tooltip">
          Base Voe Pedra Azul
        </Tooltip>
      </CircleMarker>

      {/* Trajetórias de deriva */}
      {series.map((s) => (
        <Fragment key={s.label}>
          <Polyline
            positions={s.drift.map((p) => [p.lat, p.lon])}
            pathOptions={{ color: s.color, weight: 4, opacity: 0.95 }}
          />
          {s.drift.slice(1).map((p, i) => (
            <CircleMarker
              key={i}
              center={[p.lat, p.lon]}
              radius={4}
              pathOptions={{ color: "#fff", weight: 1.5, fillColor: s.color, fillOpacity: 1 }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                {s.label} · {p.m} m · {p.kt.toFixed(1)} kt → {p.to}°
              </Tooltip>
            </CircleMarker>
          ))}
        </Fragment>
      ))}
    </MapContainer>
  );
}
