import type { RainLevel, RainStatus } from "./scale";

// Leitura de uma fonte de chuva para um ponto (lat/lon), agora.
export interface SourceReading {
  source: string; // "Open-Meteo", "RainViewer", "Climatempo", "AccuWeather"
  ok: boolean; // o conector rodou sem erro
  configured: boolean; // tem chave/está disponível (Climatempo/AccuWeather precisam de chave)
  rainingNow: boolean;
  mmNow: number | null; // taxa de precipitação agora (mm/h)
  level: RainLevel | null; // classificação agora
  etaMin: number | null; // minutos até a chuva começar (nowcast); null se já chove ou sem previsão
  note?: string;
}

// Avaliação combinada de todas as fontes.
export interface RainAssessment {
  lat: number;
  lon: number;
  checkedAt: string; // ISO
  status: RainStatus;
  raining: boolean;
  approaching: boolean;
  mmNow: number | null;
  etaMin: number | null;
  sources: SourceReading[];
  // Overlay de radar do RainViewer para o cliente desenhar no mapa (opcional).
  radar: { tileUrl: string; frameTime: number } | null;
}
