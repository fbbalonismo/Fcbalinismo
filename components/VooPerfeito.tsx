"use client";

// Card "Voo perfeito": mostra, faixa por faixa (0–1800 m acima da base), para
// onde o vento leva o balão e se aquela altura cai na ZONA A EVITAR
// (Aracê–Reserva Água Branca, ao redor da base de Pedra Azul). Verde = navegar,
// vermelho = evitar. Marca a melhor altura para "buscar" e monta um plano de
// voo pronto para enviar no WhatsApp. Só o piloto decide.

import { cardinal, ktToKmh, type LayerWind } from "@/lib/wind";

const GREEN = "#7ED957";
const RED = "#EF5D5D";
const GOLD = "#F5A623";

// Zona a evitar, vista da base de Pedra Azul: setor de rumos (para onde o vento
// leva) que cai sobre Aracê / Reserva Água Branca (leste-sudeste da base).
const AVOID = { name: "Aracê–Reserva Água Branca", from: 95, to: 200 };

// Pontos de referência ao redor da base, por rumo (para nomear a deriva)
const LANDMARKS = [
  { deg: 90, name: "Aracê" },
  { deg: 180, name: "Reserva Água Branca" },
  { deg: 230, name: "São Paulinho de Aracê" },
  { deg: 285, name: "Caxixe" },
  { deg: 320, name: "Pedra Azul" },
];

function inAvoid(toBearing: number): boolean {
  return toBearing >= AVOID.from && toBearing <= AVOID.to;
}

function nearestLandmark(bearing: number): string {
  let best = LANDMARKS[0];
  let bestD = 999;
  for (const l of LANDMARKS) {
    const d = Math.min(Math.abs(bearing - l.deg), 360 - Math.abs(bearing - l.deg));
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best.name;
}

// Média vetorial dos rumos/velocidades das faixas (deriva dominante)
function meanDrift(layers: LayerWind[]): { to: number; kmh: number } | null {
  if (!layers.length) return null;
  let u = 0;
  let v = 0;
  for (const l of layers) {
    const r = (l.to * Math.PI) / 180;
    const s = ktToKmh(l.kt);
    u += s * Math.sin(r);
    v += s * Math.cos(r);
  }
  u /= layers.length;
  v /= layers.length;
  const to = (Math.atan2(u, v) * 180) / Math.PI;
  return { to: (to + 360) % 360, kmh: Math.round(Math.hypot(u, v)) };
}

const BAR_MAX = 1800;

export default function VooPerfeito({
  layers,
  modelLabel,
  dateLabel,
  hour,
  atBase,
  whatsapp,
}: {
  layers: LayerWind[];
  modelLabel: string;
  dateLabel: string;
  hour: number;
  atBase: boolean;
  whatsapp: string;
}) {
  const ops = layers.filter((l) => l.m <= BAR_MAX).sort((a, b) => a.m - b.m);
  if (!ops.length) return null;

  const marked = ops.map((l) => ({ ...l, avoid: atBase && inAvoid(l.to) }));
  const safe = marked.filter((l) => !l.avoid);
  const anyAvoid = marked.some((l) => l.avoid);

  // "busque": entre as faixas seguras, a de vento mais calmo (mais fácil de guiar)
  const busca = safe.length ? safe.reduce((m, l) => (l.kt < m.kt ? l : m), safe[0]) : null;
  const mean = meanDrift(ops);

  const hourLabel = `${String(hour).padStart(2, "0")}:00`;
  const yOf = (m: number) => 100 - (Math.min(m, BAR_MAX) / BAR_MAX) * 100; // % do topo

  // Texto do plano de voo para o WhatsApp
  const planText = (() => {
    const lines = [
      `Plano de voo — Voe Pedra Azul`,
      `${dateLabel} · ${hourLabel} · modelo ${modelLabel}`,
      "",
      busca
        ? `🎯 Buscar ~${busca.m} m: vento ${ktToKmh(busca.kt).toFixed(0)} km/h rumo ${busca.to}° (${cardinal(busca.to)})`
        : `Todas as faixas levam para a zona a evitar — reavaliar.`,
      mean ? `Deriva geral: ${mean.to.toFixed(0)}° (${cardinal(mean.to)})${atBase ? ` · sentido ${nearestLandmark(mean.to)}` : ""} · ${mean.kmh} km/h` : "",
      atBase
        ? anyAvoid
          ? `⚠️ Faixas em vermelho levam para ${AVOID.name}.`
          : `✅ Nenhuma altitude leva para ${AVOID.name}.`
        : "",
      "",
      `Apoio à decisão — confirmar no local. A decisão é do piloto.`,
    ];
    return lines.filter(Boolean).join("\n");
  })();
  const waHref = `${whatsapp}?text=${encodeURIComponent(planText)}`;

  return (
    <div className="voop">
      <div className="voop-title">🎯 Voo perfeito — qual altitude buscar e evitar</div>

      <div className="voop-sub">
        🎯 <b>Voo perfeito</b> <span>{modelLabel} · {dateLabel.toUpperCase()} · {hourLabel}</span>
      </div>

      <div className={anyAvoid ? "voop-banner warn" : "voop-banner ok"}>
        {!atBase ? (
          <>📍 Local personalizado — a zona a evitar é definida para a base de Pedra Azul. Aqui, escolha a altura pela deriva.</>
        ) : anyAvoid ? (
          <>
            ⚠️ <b>Atenção.</b> As faixas em vermelho levam para a zona <b>{AVOID.name}</b>. Busque as faixas verdes.
          </>
        ) : (
          <>
            ✅ <b>Voo livre.</b> Nenhuma altitude leva para a zona {AVOID.name} neste horário. Escolha a altura pela deriva que você quiser.
          </>
        )}
      </div>

      <div className="voop-body">
        {/* barra vertical 0–1800 m */}
        <div className="voop-bar-wrap">
          <div className="voop-bar">
            {marked.map((l, i) => {
              const top = yOf(l.m);
              const bottom = i > 0 ? yOf(marked[i - 1].m) : 100;
              return (
                <div
                  key={l.m}
                  className="voop-seg"
                  style={{ top: `${top}%`, height: `${bottom - top}%`, background: l.avoid ? RED : GREEN }}
                  title={`${l.m} m · ${ktToKmh(l.kt).toFixed(0)} km/h rumo ${l.to}°`}
                />
              );
            })}
            {busca && (
              <div className="voop-busca" style={{ top: `${yOf(busca.m)}%` }}>
                <span>🎯 busque</span>
              </div>
            )}
          </div>
          <div className="voop-ticks">
            {[1800, 1500, 1000, 500, 0].map((m) => (
              <div key={m} className="voop-tick" style={{ top: `${yOf(m)}%` }}>
                {m}
              </div>
            ))}
          </div>
          <div className="voop-axis">m acima da base</div>
        </div>

        {/* resumo + camadas */}
        <div className="voop-right">
          <div className="voop-legend">
            Camadas — <span style={{ color: GREEN }}>● navegar</span> · <span style={{ color: RED }}>● evitar</span> · a seta mostra para onde o vento leva
          </div>
          {mean && (
            <div className="voop-mean">
              <div>
                <div className="voop-mean-k">Deriva dominante</div>
                <div className="voop-mean-v">
                  {cardinal(mean.to)} {mean.to.toFixed(0)}°{atBase ? ` · sentido ${nearestLandmark(mean.to)}` : ""}
                </div>
              </div>
              <div className="voop-mean-speed">{mean.kmh} km/h</div>
            </div>
          )}
          <a className="voop-wa" href={waHref} target="_blank" rel="noreferrer">
            📱 Enviar plano de voo no WhatsApp
          </a>
        </div>
      </div>

      <div className="voop-foot">
        As setas/rumos mostram <b>para onde o vento leva</b> em cada faixa. Isto é um apoio — a decisão é sempre do
        piloto, com leitura do céu e do vento no local.
      </div>
    </div>
  );
}
