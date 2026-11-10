"use client";

import { Fragment } from "react";
import { MODELS, type ModelId } from "@/lib/config";
import { cardinal, ktToKmh } from "@/lib/wind";
import type { HourForecast } from "@/lib/openmeteo";

// Limites (em kt, unidade interna) — os mesmos do semáforo de decolagem
const CALM_KT = 7;
const MOD_KT = 12;
const BAR_MAX_KT = 20; // escala fixa da barra (~37 km/h) para comparar dias
const OPS_MAX_M = 1000; // faixa usada no semáforo de decolagem
const TURN_DEG = 30; // virada mínima entre camadas para marcar
const DIR_MIN_KT = 3; // abaixo disso a direção é pouco confiável

function speedColor(kt: number) {
  if (kt < CALM_KT) return "#7ED957";
  if (kt < MOD_KT) return "#F5A623";
  return "#EF5D5D";
}

// Menor ângulo entre duas direções, com sinal (+ horário, − anti-horário)
function angDiff(a: number, b: number) {
  return ((b - a + 540) % 360) - 180;
}

interface Row {
  key: string;
  m: number; // 0 = solo
  label: string;
  ft: number | null;
  kt: number;
  from: number;
  to: number;
  others: { id: ModelId; color: string; label: string; kt: number; to: number }[];
}

type Agreement = "alta" | "media" | "baixa" | null;

function agreement(row: Row, activeColor: string): Agreement {
  const all = [{ kt: row.kt, to: row.to, color: activeColor }, ...row.others];
  if (all.length < 2) return null;
  const speeds = all.map((x) => x.kt);
  const range = Math.max(...speeds) - Math.min(...speeds);
  // Direção só conta quando há vento suficiente para ela significar algo
  const dirs = all.filter((x) => x.kt >= DIR_MIN_KT).map((x) => x.to);
  let spread = 0;
  for (let i = 0; i < dirs.length; i++)
    for (let j = i + 1; j < dirs.length; j++) spread = Math.max(spread, Math.abs(angDiff(dirs[i], dirs[j])));
  if (spread > 60 || range > 8) return "baixa";
  if (spread > 25 || range > 4) return "media";
  return "alta";
}

const AGREE_LABEL = { alta: "Modelos concordam", media: "Concordância média", baixa: "Modelos divergem" };

function Arrow({ to, size = 22, color = "#EAF2FB", width = 2.4 }: { to: number; size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${to}deg)` }} aria-hidden>
      <path
        d="M12 2 L12 20 M12 2 L6 9 M12 2 L18 9"
        stroke={color}
        strokeWidth={width}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function WindLayers({
  byModel,
  model,
  onModel,
  elevation,
}: {
  byModel: Partial<Record<ModelId, HourForecast>> | null;
  model: ModelId;
  onModel: (id: ModelId) => void;
  elevation: number | null;
}) {
  const active = byModel?.[model];
  const activeMeta = MODELS.find((m) => m.id === model)!;

  if (!active) {
    return (
      <div className="layers-card wl">
        <p className="loading">{byModel ? "Sem dados para este horário." : "Carregando…"}</p>
      </div>
    );
  }

  const othersAt = (m: number) =>
    MODELS.filter((x) => x.id !== model).flatMap((x) => {
      const h = byModel?.[x.id];
      const w = m === 0 ? h?.surface : h?.layers.find((l) => l.m === m);
      return w ? [{ id: x.id, color: x.color, label: x.label, kt: w.kt, to: w.to }] : [];
    });

  // Ordem de baixo para cima no dado; exibida de cima para baixo (como uma sondagem)
  const asc: Row[] = [];
  if (active.surface)
    asc.push({ key: "solo", m: 0, label: "Solo", ft: null, ...active.surface, others: othersAt(0) });
  for (const l of active.layers)
    asc.push({ key: String(l.m), m: l.m, label: `${l.m} m`, ft: l.ft, kt: l.kt, from: l.from, to: l.to, others: othersAt(l.m) });

  // Viradas de vento entre camadas vizinhas (é onde o piloto consegue mudar de rumo)
  const turns = new Map<string, number>(); // chave da camada de cima -> graus
  for (let i = 1; i < asc.length; i++) {
    const a = asc[i - 1], b = asc[i];
    if (a.kt < DIR_MIN_KT || b.kt < DIR_MIN_KT) continue;
    const d = angDiff(a.to, b.to);
    if (Math.abs(d) >= TURN_DEG) turns.set(b.key, d);
  }

  // Resumo para o piloto
  const air = asc.filter((r) => r.m > 0);
  const ops = air.filter((r) => r.m <= OPS_MAX_M);
  const calmest = ops.length ? ops.reduce((a, b) => (b.kt < a.kt ? b : a)) : null;
  const strongest = air.length ? air.reduce((a, b) => (b.kt > a.kt ? b : a)) : null;
  const dirs = air.filter((r) => r.kt >= DIR_MIN_KT).map((r) => r.to);
  let fan = 0; // abertura de rumos disponíveis (o quanto dá para "escolher" direção)
  for (let i = 0; i < dirs.length; i++)
    for (let j = i + 1; j < dirs.length; j++) fan = Math.max(fan, Math.abs(angDiff(dirs[i], dirs[j])));
  const diverge = asc.filter((r) => agreement(r, activeMeta.color) === "baixa").map((r) => r.label);

  const rows = [...asc].reverse();

  return (
    <div className="layers-card wl">
      <div className="wl-tabs" role="tablist" aria-label="Modelo">
        {MODELS.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={m.id === model}
            className={m.id === model ? "on" : ""}
            style={{ ["--c" as string]: m.color }}
            onClick={() => onModel(m.id)}
          >
            <i /> {m.label}
          </button>
        ))}
      </div>

      <div className="wl-summary">
        {calmest && (
          <div>
            <span>Mais calmo ≤ 1000 m</span>
            <strong style={{ color: speedColor(calmest.kt) }}>
              {calmest.label} · {ktToKmh(calmest.kt).toFixed(0)} km/h
            </strong>
          </div>
        )}
        {strongest && (
          <div>
            <span>Mais forte</span>
            <strong style={{ color: speedColor(strongest.kt) }}>
              {strongest.label} · {ktToKmh(strongest.kt).toFixed(0)} km/h
            </strong>
          </div>
        )}
        <div>
          <span>Rumos possíveis</span>
          <strong>{fan < 20 ? "Um só rumo" : `Leque de ${Math.round(fan)}°`}</strong>
        </div>
        <div>
          <span>Modelos</span>
          <strong style={{ color: diverge.length ? "#EF5D5D" : "#7ED957" }}>
            {diverge.length ? `Divergem em ${diverge.length} camada${diverge.length > 1 ? "s" : ""}` : "Concordam"}
          </strong>
        </div>
      </div>

      <div className="wl-head">
        <div>Altura</div>
        <div>Vai para</div>
        <div>Velocidade</div>
        <div className="wl-cmp">Outros</div>
      </div>

      <div className="wl-rows">
        {rows.map((r, idx) => {
          const ag = agreement(r, activeMeta.color);
          const turn = turns.get(r.key);
          const prev = rows[idx - 1];
          const opsStart = r.m <= OPS_MAX_M && r.m > 0 && (!prev || prev.m > OPS_MAX_M);
          return (
            <Fragment key={r.key}>
              {opsStart && (
                <div className="wl-zone">
                  <span>Faixa de decisão · até {OPS_MAX_M} m</span>
                </div>
              )}
              <div className={`wl-row${r.m === 0 ? " ground" : ""}${r.m > 0 && r.m <= OPS_MAX_M ? " ops" : ""}`}>
                <div className="wl-alt">
                  {r.label}
                  {r.ft !== null && <small>{r.ft.toLocaleString("pt-BR")} ft</small>}
                </div>
                <div className="wl-dir">
                  <span className="wl-arrow" style={{ borderColor: speedColor(r.kt) }}>
                    <Arrow to={r.to} />
                  </span>
                  <span className="wl-card">
                    {cardinal(r.to)}
                    <small>vem de {cardinal(r.from)}</small>
                  </span>
                </div>
                <div className="wl-speed">
                  <div className="wl-kmh" style={{ color: speedColor(r.kt) }}>
                    {ktToKmh(r.kt).toFixed(0)}
                    <small>km/h</small>
                  </div>
                  <div className="wl-bar">
                    <i style={{ width: `${Math.min(100, (r.kt / BAR_MAX_KT) * 100)}%`, background: speedColor(r.kt) }} />
                  </div>
                </div>
                <div className="wl-cmp" title={ag ? AGREE_LABEL[ag] : undefined}>
                  {r.others.map((o) => (
                    <span key={o.id} className="wl-mini" title={`${o.label}: ${ktToKmh(o.kt).toFixed(0)} km/h para ${cardinal(o.to)}`}>
                      <Arrow to={o.to} size={15} color={o.color} width={3} />
                    </span>
                  ))}
                  {ag && <span className={`wl-ag ${ag}`} aria-label={AGREE_LABEL[ag]} />}
                </div>
              </div>
              {turn !== undefined && rows[idx + 1] && (
                <div className={`wl-turn${r.m <= OPS_MAX_M ? " ops" : ""}`}>
                  <span>
                    ↻ vira {Math.abs(Math.round(turn))}° {turn > 0 ? "à direita" : "à esquerda"} subindo de{" "}
                    {rows[idx + 1].label} para {r.label}
                  </span>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      <div className="legend-row">
        <span>
          <span className="sw" style={{ background: "#7ED957" }} />
          Calmo
        </span>
        <span>
          <span className="sw" style={{ background: "#F5A623" }} />
          Moderado
        </span>
        <span>
          <span className="sw" style={{ background: "#EF5D5D" }} />
          Forte
        </span>
        <span>
          <span className="wl-ag alta" /> <span className="wl-ag media" /> <span className="wl-ag baixa" /> concordância dos modelos
        </span>
        <span style={{ flexBasis: "100%" }}>
          Leia de baixo para cima, como o balão sobe. A seta aponta para onde o balão vai. Alturas acima da base
          {elevation != null ? ` (${Math.round(elevation)} m)` : ""}.
        </span>
      </div>
    </div>
  );
}
