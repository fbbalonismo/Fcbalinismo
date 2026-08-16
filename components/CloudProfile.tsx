"use client";

// Desenho gráfico (SVG) do céu em corte vertical: nuvens baixas/médias/altas na
// altura certa, a faixa de voo do balão (0–1800 m) e neblina/nevoeiro no solo.
// Densidade/opacidade das nuvens ∝ cobertura (%). Facilita a leitura visual.

interface Props {
  low: number | null;
  mid: number | null;
  high: number | null;
  visibilityM: number | null;
  baseElevM?: number;
}

// mapeia altitude (km) para y no SVG
const GROUND_Y = 292;
const TOP_Y = 18;
const MAX_KM = 12;
const yOf = (km: number) => GROUND_Y - (Math.min(km, MAX_KM) / MAX_KM) * (GROUND_Y - TOP_Y);

const SKY_X0 = 52;
const SKY_X1 = 300;

function Cloud({ x, y, s, o }: { x: number; y: number; s: number; o: number }) {
  return (
    <g opacity={o} fill="#eaf2fb">
      <ellipse cx={x} cy={y} rx={17 * s} ry={9 * s} />
      <circle cx={x - 11 * s} cy={y + 1.5 * s} r={8 * s} />
      <circle cx={x + 1 * s} cy={y - 6 * s} r={9.5 * s} />
      <circle cx={x + 12 * s} cy={y + 0.5 * s} r={7 * s} />
    </g>
  );
}

// desenha uma camada de nuvens dentro de [yTop, yBot] conforme a cobertura
function layerClouds(cov: number, yTop: number, yBot: number, s: number) {
  const n = Math.min(4, Math.round(cov / 25)); // 0–4 nuvens
  if (n === 0) return null;
  const o = 0.35 + (cov / 100) * 0.55;
  const cy = (yTop + yBot) / 2;
  const slots = [80, 135, 190, 245];
  return slots.slice(0, n).map((x, i) => <Cloud key={i} x={x} y={cy + (i % 2 === 0 ? -4 : 4)} s={s} o={o} />);
}

export default function CloudProfile({ low, mid, high, visibilityM }: Props) {
  const L = low ?? 0;
  const M = mid ?? 0;
  const H = high ?? 0;
  const vis = visibilityM;
  // neblina no solo
  const fog =
    vis == null ? null : vis < 1000 ? "nevoeiro" : vis < 4000 ? "nevoa" : null;
  const balloonY = yOf(1.8);

  const ticks: { km: number; label: string }[] = [
    { km: 0, label: "solo" },
    { km: 1.8, label: "1,8 km" },
    { km: 3, label: "3 km" },
    { km: 8, label: "8 km" },
    { km: 12, label: "12 km" },
  ];

  return (
    <svg viewBox="0 0 340 312" width="100%" role="img" aria-label="Perfil de nuvens por altura" style={{ display: "block" }}>
      <defs>
        <linearGradient id="cpsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a2036" />
          <stop offset="1" stopColor="#123657" />
        </linearGradient>
        <linearGradient id="cpfog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(200,210,220,0)" />
          <stop offset="1" stopColor="rgba(210,218,228,0.85)" />
        </linearGradient>
      </defs>

      {/* céu */}
      <rect x={SKY_X0 - 2} y={TOP_Y - 2} width={SKY_X1 - SKY_X0 + 46} height={GROUND_Y - TOP_Y + 4} rx="10" fill="url(#cpsky)" />

      {/* faixa do balão 0–1800 m */}
      <rect x={SKY_X0 - 2} y={balloonY} width={SKY_X1 - SKY_X0 + 46} height={GROUND_Y - balloonY} fill="rgba(245,166,35,0.12)" />
      <line x1={SKY_X0 - 2} y1={balloonY} x2={SKY_X1 + 44} y2={balloonY} stroke="#F5A623" strokeWidth="1" strokeDasharray="4 3" opacity="0.8" />
      <text x={SKY_X1 + 40} y={balloonY - 5} textAnchor="end" fontSize="10" fill="#F5A623">
        faixa do balão
      </text>

      {/* nuvens por camada */}
      {layerClouds(H, yOf(12), yOf(8), 0.72)}
      {layerClouds(M, yOf(8), yOf(3), 0.9)}
      {layerClouds(L, yOf(3), yOf(0), 1.05)}

      {/* % por camada, à direita */}
      <text x={SKY_X1 + 40} y={(yOf(12) + yOf(8)) / 2} textAnchor="end" fontSize="10.5" fill="#b9cddf">
        altas {H}%
      </text>
      <text x={SKY_X1 + 40} y={(yOf(8) + yOf(3)) / 2} textAnchor="end" fontSize="10.5" fill="#b9cddf">
        médias {M}%
      </text>
      <text x={SKY_X1 + 40} y={yOf(1.2)} textAnchor="end" fontSize="10.5" fill="#b9cddf">
        baixas {L}%
      </text>

      {/* neblina / nevoeiro no solo */}
      {fog && (
        <>
          <rect
            x={SKY_X0 - 2}
            y={fog === "nevoeiro" ? yOf(0.3) : yOf(0.15)}
            width={SKY_X1 - SKY_X0 + 46}
            height={GROUND_Y - (fog === "nevoeiro" ? yOf(0.3) : yOf(0.15))}
            fill="url(#cpfog)"
            opacity={fog === "nevoeiro" ? 1 : 0.6}
          />
          <text x={(SKY_X0 + SKY_X1) / 2} y={GROUND_Y - 6} textAnchor="middle" fontSize="10.5" fill="#3a4756" fontWeight="700">
            {fog === "nevoeiro" ? "NEVOEIRO no solo" : "névoa baixa"}
          </text>
        </>
      )}

      {/* solo */}
      <rect x={SKY_X0 - 2} y={GROUND_Y} width={SKY_X1 - SKY_X0 + 46} height={16} rx="3" fill="#2a5d38" />
      {/* balão */}
      <text x={70} y={GROUND_Y - 2} fontSize="18">
        🎈
      </text>

      {/* escala de altitude à esquerda */}
      {ticks.map((t) => (
        <g key={t.km}>
          <line x1={SKY_X0 - 4} y1={yOf(t.km)} x2={SKY_X0 - 1} y2={yOf(t.km)} stroke="#7fa5c4" strokeWidth="1" />
          <text x={SKY_X0 - 7} y={yOf(t.km) + 3.5} textAnchor="end" fontSize="9.5" fill="#7fa5c4">
            {t.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
