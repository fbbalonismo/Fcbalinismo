// Escala de chuva única do app — usada pelo classificador de nowcast, pela rota
// /api/chuva e pelo cliente, para não divergirem.

// Níveis observáveis de intensidade (com faixa de mm/h correspondente).
export type RainLevel = "sem" | "sereno" | "leve" | "moderada" | "intensa";

// "aproximacao" não é um nível de intensidade medido no solo — é um estado de
// alerta (radar/nowcast indica nuvem de chuva chegando). Fica fora das faixas.
export type RainStatus = RainLevel | "aproximacao";

// Faixas de precipitação (mm/h). Mantém leve/moderada/intensa iguais às
// originais e apenas divide o antigo "sem" [0,0.2] em sem [0,0.1] + sereno.
export const RAIN_RANGES: Record<RainLevel, [number, number]> = {
  sem: [0, 0.1],
  sereno: [0.1, 0.2],
  leve: [0.2, 2.5],
  moderada: [2.5, 10],
  intensa: [10, Infinity],
};

export const RAIN_LEVELS: RainLevel[] = ["sem", "sereno", "leve", "moderada", "intensa"];

// Ordem de severidade (para escolher o "pior" entre fontes). aproximacao fica
// entre sereno e leve em prioridade de exibição, mas é tratado à parte.
const SEVERITY: Record<RainStatus, number> = {
  sem: 0,
  aproximacao: 1,
  sereno: 2,
  leve: 3,
  moderada: 4,
  intensa: 5,
};

export function rainSeverity(s: RainStatus): number {
  return SEVERITY[s];
}

// Classifica uma taxa de precipitação (mm/h) num nível.
export function classifyMm(mmPerHour: number): RainLevel {
  for (const level of RAIN_LEVELS) {
    const [lo, hi] = RAIN_RANGES[level];
    if (mmPerHour >= lo && mmPerHour < hi) return level;
  }
  return "intensa";
}

// É "chuva de verdade" (não apenas sem/sereno residual)?
export function isRaining(level: RainLevel): boolean {
  return level === "leve" || level === "moderada" || level === "intensa" || level === "sereno";
}

export const RAIN_LABELS: Record<RainStatus, string> = {
  sem: "Sem chuva",
  sereno: "Sereno",
  aproximacao: "Aproximação de nuvem",
  leve: "Chuva leve",
  moderada: "Moderada",
  intensa: "Intensa+",
};
