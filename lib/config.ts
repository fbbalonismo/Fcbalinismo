export const BASE = {
  name: "Vila de Pedra Azul / Base Voe Pedra Azul",
  // Ponto exato informado pelo André: 20°22'56.33"S 41°01'28.46"W (pé da Pedra Azul)
  lat: -20.382314,
  lon: -41.024572,
  // Elevação real do terreno (Google Earth); a grade do modelo diz ~1205 m
  elevation: 1062,
};

// Referências visuais por azimute a partir da base (informadas pelo André)
export const REFERENCES = [
  { bearing: 0, name: "Rota do Carmo" },
  { bearing: 90, name: "Aracê" },
  { bearing: 180, name: "Reserva Água Branca" },
  { bearing: 230, name: "São Paulinho de Aracê" },
  { bearing: 270, name: "Caxixe" },
  { bearing: 330, name: "Fazenda do Estado" },
];

// Camadas-alvo em metros acima do solo (AGL)
export const LAYERS_M = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800,
];

export const MODELS = [
  { id: "ecmwf_ifs025", label: "ECMWF", color: "#57B7EA", abbr: "EC", provider: "Centro Europeu" },
  { id: "gfs_seamless", label: "GFS", color: "#F5A623", abbr: "GF", provider: "NOAA · EUA" },
  { id: "icon_seamless", label: "ICON", color: "#7ED957", abbr: "IC", provider: "DWD · Alemanha" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];

export const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700];

export const TIMEZONE = "America/Sao_Paulo";

// Horas exibidas no seletor (janelas de voo da manhã e da tarde)
export const HOURS = [5, 6, 7, 8, 9, 15, 16, 17, 18];

// Taxa de subida assumida para o cálculo da deriva (m/s)
export const CLIMB_RATE_MS = 1.0;
