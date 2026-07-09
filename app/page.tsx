"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { HOURS, MODELS, type ModelId } from "@/lib/config";
import { cardinal, type LayerWind } from "@/lib/wind";
import type { ForecastResponse, HourForecast } from "@/lib/openmeteo";
import type { DriftSeries } from "@/components/DriftMap";

const DriftMap = dynamic(() => import("@/components/DriftMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Carregando mapa…</div>,
});

type Tab = ModelId | "compare";

const DAY_LABELS = ["Hoje", "Amanhã", "Dep. amanhã"];

function dateForDay(offset: number): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  now.setDate(now.getDate() + offset);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function windArrow(to: number) {
  return (
    <span className="arrow" style={{ transform: `rotate(${to}deg)` }} aria-hidden>
      ↑
    </span>
  );
}

function verdict(layers: LayerWind[], surfaceKt: number | null) {
  // Veredito considera só até 1000 m (faixa operacional típica); acima disso é informativo
  const ops = layers.filter((l) => l.m <= 1000);
  const maxKt = Math.max(...ops.map((l) => l.kt));
  const sfc = surfaceKt ?? 0;
  if (sfc <= 5 && maxKt <= 10) return { label: "Vento fraco", cls: "ok", desc: "condição favorável" };
  if (sfc <= 8 && maxKt <= 15) return { label: "Vento moderado", cls: "warn", desc: "avaliar com atenção" };
  return { label: "Vento forte", cls: "bad", desc: "condição desfavorável" };
}

export default function Home() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(6);
  const [tab, setTab] = useState<Tab>("compare");

  useEffect(() => {
    fetch("/api/forecast")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const targetTime = `${dateForDay(day)}T${String(hour).padStart(2, "0")}:00`;

  const byModel = useMemo(() => {
    if (!data) return null;
    const out: Partial<Record<ModelId, HourForecast>> = {};
    for (const m of MODELS) {
      out[m.id] = data.models[m.id]?.hours.find((h) => h.time === targetTime);
    }
    return out;
  }, [data, targetTime]);

  if (error)
    return (
      <main className="shell">
        <p className="error">Erro ao carregar a previsão: {error}. Recarregue a página.</p>
      </main>
    );
  if (!data || !byModel)
    return (
      <main className="shell">
        <p className="loading">Carregando previsão…</p>
      </main>
    );

  const activeModels = tab === "compare" ? [...MODELS] : MODELS.filter((m) => m.id === tab);
  const series: DriftSeries[] = activeModels.flatMap((m) => {
    const h = byModel[m.id];
    return h ? [{ label: m.label, color: m.color, drift: h.drift }] : [];
  });

  const primary = byModel[tab === "compare" ? "ecmwf_ifs025" : (tab as ModelId)] ?? byModel.gfs_seamless;
  const dateLabel = new Date(`${targetTime}:00-03:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <main className="shell">
      <header className="topbar">
        <h1>🎈 Voe Pedra Azul — Vento em camadas</h1>
        <p className="sub">
          {data.base.name} · elevação {Math.round(data.elevation)} m
        </p>
      </header>

      <section className="selectors">
        <div className="chips">
          {DAY_LABELS.map((label, i) => (
            <button key={i} className={day === i ? "chip active" : "chip"} onClick={() => setDay(i)}>
              {label}
            </button>
          ))}
        </div>
        <div className="chips">
          {HOURS.map((h) => (
            <button key={h} className={hour === h ? "chip active" : "chip"} onClick={() => setHour(h)}>
              {String(h).padStart(2, "0")}h
            </button>
          ))}
        </div>
        <div className="chips">
          {MODELS.map((m) => (
            <button
              key={m.id}
              className={tab === m.id ? "chip active" : "chip"}
              style={tab === m.id ? { background: m.color, borderColor: m.color } : undefined}
              onClick={() => setTab(m.id)}
            >
              {m.label}
            </button>
          ))}
          <button className={tab === "compare" ? "chip active" : "chip"} onClick={() => setTab("compare")}>
            Comparar
          </button>
        </div>
      </section>

      <p className="datecap">
        {dateLabel} às {String(hour).padStart(2, "0")}:00
      </p>

      {!primary ? (
        <p className="error">Sem dados de previsão para este horário.</p>
      ) : (
        <>
          <Summary hour={primary} />

          <section className="mapbox">
            <DriftMap series={series} />
            {tab === "compare" && (
              <div className="legend">
                {MODELS.map((m) => (
                  <span key={m.id}>
                    <i style={{ background: m.color }} /> {m.label}
                  </span>
                ))}
              </div>
            )}
          </section>

          {tab === "compare" ? (
            <CompareTable byModel={byModel} />
          ) : (
            <SingleTable layers={primary.layers} surface={primary.surface} />
          )}
        </>
      )}

      <footer className="foot">
        <p>
          ⚠️ Estimativa operacional baseada nos modelos ECMWF / GFS / ICON (dados Open-Meteo).{" "}
          <b>Confirmar localmente antes da decolagem.</b>
        </p>
        <p className="tiny">
          Atualização automática a cada 30 min · de° = de onde o vento vem · para° = para onde o balão vai
        </p>
      </footer>
    </main>
  );
}

function Summary({ hour }: { hour: HourForecast }) {
  const v = verdict(hour.layers, hour.surface?.kt ?? null);
  const maxLayer = hour.layers.reduce((a, b) => (b.kt > a.kt ? b : a));
  return (
    <section className={`summary ${v.cls}`}>
      <div className="verdict">
        <b>{v.label}</b> — {v.desc}
      </div>
      <div className="facts">
        {hour.surface && (
          <span>
            Superfície: <b>{hour.surface.kt.toFixed(1)} kt</b> de {hour.surface.from}° ({cardinal(hour.surface.from)})
          </span>
        )}
        <span>
          Camada mais forte: <b>{maxLayer.kt.toFixed(1)} kt</b> a {maxLayer.m} m, indo para {maxLayer.to}° (
          {cardinal(maxLayer.to)})
        </span>
      </div>
    </section>
  );
}

function SingleTable({ layers, surface }: { layers: LayerWind[]; surface: HourForecast["surface"] }) {
  return (
    <section className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>m</th>
            <th>ft</th>
            <th>de°</th>
            <th>kt</th>
            <th>para°</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {surface && (
            <tr className="sfc">
              <td>solo</td>
              <td>—</td>
              <td>{surface.from}°</td>
              <td>{surface.kt.toFixed(1)}</td>
              <td>
                {surface.to}° {cardinal(surface.to)}
              </td>
              <td>{windArrow(surface.to)}</td>
            </tr>
          )}
          {layers.map((l) => (
            <tr key={l.m}>
              <td>{l.m}</td>
              <td>{l.ft}</td>
              <td>{l.from}°</td>
              <td>{l.kt.toFixed(1)}</td>
              <td>
                {l.to}° {cardinal(l.to)}
              </td>
              <td>{windArrow(l.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CompareTable({ byModel }: { byModel: Partial<Record<ModelId, HourForecast>> }) {
  const reference = MODELS.map((m) => byModel[m.id]).find((h) => h && h.layers.length > 0);
  if (!reference) return null;
  return (
    <section className="tablewrap">
      <table className="compare">
        <thead>
          <tr>
            <th rowSpan={2}>m</th>
            {MODELS.map((m) => (
              <th key={m.id} colSpan={3} style={{ color: m.color }}>
                {m.label}
              </th>
            ))}
          </tr>
          <tr>
            {MODELS.map((m) => (
              <SubHead key={m.id} />
            ))}
          </tr>
        </thead>
        <tbody>
          {reference.layers.map((row, i) => (
            <tr key={row.m}>
              <td>{row.m}</td>
              {MODELS.map((m) => {
                const l = byModel[m.id]?.layers[i];
                return l ? (
                  <SubRow key={m.id} l={l} />
                ) : (
                  <td key={m.id} colSpan={3}>
                    —
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SubHead() {
  return (
    <>
      <th>kt</th>
      <th>para°</th>
      <th></th>
    </>
  );
}

function SubRow({ l }: { l: LayerWind }) {
  return (
    <>
      <td>{l.kt.toFixed(1)}</td>
      <td>{l.to}°</td>
      <td>{windArrow(l.to)}</td>
    </>
  );
}
