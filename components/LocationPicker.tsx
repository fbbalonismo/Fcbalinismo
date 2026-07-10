"use client";

import { useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASE } from "@/lib/config";

// Seletor de local de decolagem: buscar pelo nome (geocoding Open-Meteo,
// gratuito) ou tocar no mapa para fixar um ponto.

export interface PickedLoc {
  lat: number;
  lon: number;
  name: string;
}

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
}

const pinIcon = L.divIcon({
  html: `<div class="pick-pin">📍</div>`,
  className: "pick-pin-wrap",
  iconSize: undefined,
});

function ClickToPin({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  if (target) map.flyTo(target, 12, { duration: 0.8 });
  return null;
}

export default function LocationPicker({
  onSelect,
  onClose,
}: {
  onSelect: (loc: PickedLoc | null) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState<PickedLoc | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const r = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&language=pt&count=6`
      );
      const j = await r.json();
      setResults(j.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (g: GeoResult) => {
    const name = [g.name, g.admin1].filter(Boolean).join(" — ");
    setPin({ lat: g.latitude, lon: g.longitude, name });
    setFlyTarget([g.latitude, g.longitude]);
    setResults([]);
    setQuery(name);
  };

  const pickMap = (lat: number, lon: number) => {
    setPin({ lat, lon, name: `Ponto no mapa (${lat.toFixed(4)}, ${lon.toFixed(4)})` });
    setFlyTarget(null);
  };

  return (
    <div className="picker-overlay">
      <div className="picker-top">
        <div className="picker-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Buscar cidade ou lugar…"
          />
          <button onClick={search} disabled={searching}>
            {searching ? "…" : "Buscar"}
          </button>
        </div>
        {results.length > 0 && (
          <div className="picker-results">
            {results.map((g, i) => (
              <button key={i} onClick={() => pickResult(g)}>
                {g.name}
                {g.admin1 ? ` — ${g.admin1}` : ""} {g.country ? `(${g.country})` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="picker-map">
        <MapContainer
          center={[BASE.lat, BASE.lon]}
          zoom={9}
          style={{ height: "100%", width: "100%" }}
          attributionControl={false}
        >
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
          <ClickToPin onPick={pickMap} />
          <FlyTo target={flyTarget} />
          {pin && <Marker position={[pin.lat, pin.lon]} icon={pinIcon} />}
        </MapContainer>
      </div>

      <div className="picker-actions">
        <button className="picker-use" disabled={!pin} onClick={() => pin && onSelect(pin)}>
          ✓ Usar este local
        </button>
        <button className="picker-reset" onClick={() => onSelect(null)}>
          Voltar para Pedra Azul
        </button>
        <button className="picker-cancel" onClick={onClose}>
          Cancelar
        </button>
      </div>
      <div className="picker-hint">Toque no mapa para fixar o ponto de decolagem, ou busque pelo nome</div>
    </div>
  );
}
