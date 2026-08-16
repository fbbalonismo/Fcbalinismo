"use client";

// Card "Segurança do ar": cinco fatores que afetam a qualidade/segurança do voo,
// calculados para o dia + hora escolhidos na janela de voo. Não dá veredito de
// "pode voar" — apenas mostra os parâmetros para a decisão do piloto.

import { ktToKmh, type LayerWind } from "@/lib/wind";
import type { HourForecast } from "@/lib/openmeteo";

const GREEN = "#7ED957";
const ORANGE = "#F5A623";
const RED = "#EF5D5D";

type Sev = 0 | 1 | 2; // 0 = ok, 1 = atenção, 2 = risco
const SEV_COLOR = [GREEN, ORANGE, RED] as const;

interface Factor {
  emoji: string;
  name: string;
  status: string;
  sev: Sev;
  desc: string;
}

// Altitude-densidade: altura em que o ar "se comporta" (afeta sustentação e queima).
function densityAltitude(tempC: number, pressureHpa: number): number {
  const PA = 44330 * (1 - Math.pow(pressureHpa / 1013.25, 0.190284)); // altitude-pressão (m)
  const isa = 15 - 0.0065 * PA; // temperatura ISA naquela altitude
  return PA + 118.8 * (tempC - isa); // altitude-densidade (m)
}

// Cortante (wind shear): maior variação vetorial do vento por 100 m entre as camadas.
function maxShearKmhPer100m(layers: LayerWind[], surface: HourForecast["surface"]): number | null {
  const pts: { m: number; kt: number; dir: number }[] = [];
  if (surface) pts.push({ m: 10, kt: surface.kt, dir: surface.from });
  for (const l of layers) pts.push({ m: l.m, kt: l.kt, dir: l.from });
  pts.sort((a, b) => a.m - b.m);
  if (pts.length < 2) return null;
  const vec = (p: { kt: number; dir: number }) => {
    const r = (p.dir * Math.PI) / 180;
    return { u: p.kt * Math.sin(r), v: p.kt * Math.cos(r) };
  };
  let max = 0;
  for (let i = 1; i < pts.length; i++) {
    const dh = pts[i].m - pts[i - 1].m;
    if (dh < 20) continue;
    const a = vec(pts[i]);
    const b = vec(pts[i - 1]);
    const dKt = Math.hypot(a.u - b.u, a.v - b.v);
    const per100 = (dKt / dh) * 100;
    if (per100 > max) max = per100;
  }
  return ktToKmh(max);
}

function computeFactors(h: HourForecast, elevationM: number): Factor[] {
  const factors: Factor[] = [];

  // 1) Altitude-densidade
  if (h.tempC != null && h.pressureHpa != null) {
    const da = densityAltitude(h.tempC, h.pressureHpa);
    const above = da - elevationM;
    const sev: Sev = above > 1300 ? 2 : above > 600 ? 1 : 0;
    factors.push({
      emoji: "🎈",
      name: "Altitude-densidade",
      status: sev === 0 ? "Sustentação normal" : sev === 1 ? "Sustentação reduzida" : "Sustentação baixa",
      sev,
      desc: `Ar se comporta como ${Math.round(da)} m (${Math.abs(Math.round(above))} m ${
        above >= 0 ? "acima" : "abaixo"
      } do terreno)`,
    });
  }

  // 2) Rajada / turbulência
  if (h.gustKt != null && h.surface) {
    const gustKmh = ktToKmh(h.gustKt);
    const meanKmh = ktToKmh(h.surface.kt);
    const factor = meanKmh > 1 ? gustKmh / meanKmh : 1;
    const sev: Sev = factor >= 2 || gustKmh >= 28 ? 2 : factor >= 1.6 || gustKmh >= 18 ? 1 : 0;
    factors.push({
      emoji: "🚩",
      name: "Rajada / turbulência",
      status: sev === 0 ? "Rajadas fracas" : sev === 1 ? "Rajadas moderadas" : "Rajadas fortes",
      sev,
      desc: `Rajada até ${gustKmh.toFixed(0)} km/h · ${factor.toFixed(1)}× o vento médio`,
    });
  }

  // 3) Cortante entre camadas
  const shear = maxShearKmhPer100m(h.layers, h.surface);
  if (shear != null) {
    const sev: Sev = shear > 12 ? 2 : shear > 5 ? 1 : 0;
    factors.push({
      emoji: "🔀",
      name: "Cortante entre camadas",
      status: sev === 0 ? "Vento uniforme" : sev === 1 ? "Cortante moderada" : "Cortante forte",
      sev,
      desc: `Até ${shear.toFixed(0)} km/h a cada 100 m`,
    });
  }

  // 4) Instabilidade / tempestade (CAPE)
  if (h.capeJkg != null) {
    const c = h.capeJkg;
    const sev: Sev = c > 1000 ? 2 : c > 300 ? 1 : 0;
    factors.push({
      emoji: "⛈️",
      name: "Instabilidade / tempestade",
      status: sev === 0 ? "Atmosfera estável" : sev === 1 ? "Instabilidade moderada" : "Risco de tempestade",
      sev,
      desc: `Energia de instabilidade (CAPE) ${c} J/kg`,
    });
  }

  // 5) Neblina / visibilidade
  if (h.tempC != null && h.dewC != null) {
    const spread = h.tempC - h.dewC;
    const vis = h.visibilityM;
    const fog = h.weatherCode === 45 || h.weatherCode === 48 || (vis != null && vis < 1000);
    const haze = spread <= 2.5 || (vis != null && vis < 4000) || (h.rhPct != null && h.rhPct >= 95);
    const sev: Sev = fog ? 2 : haze ? 1 : 0;
    factors.push({
      emoji: "🌫️",
      name: "Neblina / visibilidade",
      status: sev === 0 ? "Boa visibilidade" : sev === 1 ? "Umidade alta / névoa" : "Nevoeiro",
      sev,
      desc: `Temperatura ${h.tempC}°C, orvalho ${h.dewC}°C (folga de ${spread.toFixed(1)}°C)`,
    });
  }

  return factors;
}

export default function AirSafety({
  hour,
  elevationM,
  modelLabel,
}: {
  hour: HourForecast;
  elevationM: number;
  modelLabel: string;
}) {
  const factors = computeFactors(hour, elevationM);
  if (!factors.length) return null;
  let worst: Sev = 0;
  for (const f of factors) if (f.sev > worst) worst = f.sev;
  const headline =
    worst === 0
      ? "Condições favoráveis"
      : worst === 1
      ? "Atenção a alguns fatores"
      : "Fatores de risco — avalie com cuidado";

  return (
    <div className="airsafety">
      <div className="airsafety-head">
        <span className="airsafety-dot" style={{ background: SEV_COLOR[worst] }} />
        <strong>{headline}</strong>
        <span className="airsafety-model">MODELO {modelLabel.toUpperCase()}</span>
      </div>

      <div className="airsafety-grid">
        {factors.map((f) => (
          <div key={f.name} className="airsafety-factor" style={{ borderLeftColor: SEV_COLOR[f.sev] }}>
            <div className="airsafety-factor-top">
              <span className="airsafety-emoji">{f.emoji}</span>
              <span className="airsafety-name">{f.name}</span>
            </div>
            <span
              className="airsafety-pill"
              style={{ background: SEV_COLOR[f.sev], color: f.sev === 1 ? "#3a2a00" : "#0A1724" }}
            >
              {f.status}
            </span>
            <div className="airsafety-desc">{f.desc}</div>
          </div>
        ))}
      </div>

      <div className="airsafety-foot">
        🛡️ Indicadores calculados para o horário e local escolhidos. Servem de apoio — a decisão final é sempre do
        piloto, com observação direta do céu e do vento no local.
      </div>
    </div>
  );
}
