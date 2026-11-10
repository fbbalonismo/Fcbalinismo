"use client";

// Card "Frente fria": estações do INMET a sul/sudoeste da base, com fase da
// frente em cada uma, ETA até a base e a última leitura de vento.

import { useEffect, useState } from "react";

type Fase = "sem_dados" | "normal" | "pre" | "passagem" | "pos";
type Nivel = "sem_dados" | "sem_sinal" | "monitorar" | "chegando" | "passando";

interface Estacao {
  codigo: string;
  nome: string;
  uf: string;
  distKm: number;
  rumoCardinal: string;
  upstream: boolean;
  fase: Fase;
  pressaoHpa: number | null;
  tendP3h: number | null;
  tempC: number | null;
  quedaTemp3h: number | null;
  ventoKmh: number | null;
  ventoDir: number | null;
  ventoCardinal: string | null;
  rajadaKmh: number | null;
  ventoHora: string | null;
  ventoIdadeMin: number | null;
  umidade: number | null;
  idadeMin: number | null;
  etaH: number | null;
}

interface Resp {
  resumo: { nivel: Nivel; texto: string; etaH: number | null };
  estacoes: Estacao[];
  error?: string;
}

const FASE_TXT: Record<Fase, { t: string; c: string }> = {
  sem_dados: { t: "sem dados", c: "#8a96a8" },
  normal: { t: "normal", c: "#7ED957" },
  pre: { t: "pré-frontal", c: "#F5A623" },
  passagem: { t: "frente passando", c: "#EF5D5D" },
  pos: { t: "pós-frontal", c: "#60a5fa" },
};

const NIVEL_COR: Record<Nivel, string> = {
  sem_dados: "#8a96a8",
  sem_sinal: "#7ED957",
  monitorar: "#F5A623",
  chegando: "#EF5D5D",
  passando: "#EF5D5D",
};

// horas daqui até a próxima decolagem no horário escolhido (fuso de Brasília)
function horasAteVoo(hour: number): number {
  const agora = new Date();
  const sp = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const alvo = new Date(sp);
  alvo.setHours(hour, 0, 0, 0);
  if (alvo <= sp) alvo.setDate(alvo.getDate() + 1);
  return (alvo.getTime() - sp.getTime()) / 3600e3;
}

export default function FrentesCard({ lat, lon, hour }: { lat: number; lon: number; hour: number }) {
  const [data, setData] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const carrega = () =>
      fetch(`/api/frentes?lat=${lat}&lon=${lon}`)
        .then(async (r) => {
          const j = (await r.json()) as Resp;
          if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
          return j;
        })
        .then((j) => {
          if (!vivo) return;
          setData(j);
          setErro(null);
        })
        .catch((e) => vivo && setErro(String(e.message ?? e)));
    carrega();
    const id = setInterval(carrega, 10 * 60000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [lat, lon]);

  const hVoo = horasAteVoo(hour);
  const eta = data?.resumo.etaH ?? null;
  const hh = String(hour).padStart(2, "0");

  return (
    <div className="layers-card" style={{ marginTop: 16 }}>
      <div className="card-label">Frente fria — estações do INMET</div>
      {erro && !data && <p className="loading">Não deu para ler o INMET agora: {erro}</p>}
      {!erro && !data && <p className="loading">Carregando estações…</p>}
      {data && (
        <>
          <div
            style={{
              borderLeft: `4px solid ${NIVEL_COR[data.resumo.nivel]}`,
              padding: "8px 12px",
              margin: "6px 0 12px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontWeight: 600 }}>{data.resumo.texto}</div>
            {eta != null && (
              <div style={{ fontSize: 13, marginTop: 4, color: eta <= hVoo ? "#fca5a5" : "#bbf7d0" }}>
                Voo das {hh}h é daqui a ~{Math.round(hVoo)} h →{" "}
                {eta <= hVoo ? "a frente deve chegar ANTES do voo." : "a frente deve chegar depois do voo."}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.estacoes.map((s) => {
              const f = FASE_TXT[s.fase];
              return (
                <div
                  key={s.codigo}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    gap: "4px 10px",
                    paddingBottom: 8,
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <strong style={{ fontSize: 14 }}>
                    {s.nome}/{s.uf}
                  </strong>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    {s.distKm} km a {s.rumoCardinal}
                    {!s.upstream ? " · referência local" : ""}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#0b1220",
                      background: f.c,
                      borderRadius: 999,
                      padding: "1px 8px",
                      marginLeft: "auto",
                    }}
                  >
                    {f.t}
                  </span>
                  <div style={{ fontSize: 12, opacity: 0.85, flex: "1 1 100%", display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                    {s.tempC != null && <span>{s.tempC.toFixed(1)}°C</span>}
                    {s.tendP3h != null && <span>pressão {s.tendP3h > 0 ? "+" : ""}{s.tendP3h} hPa/3h</span>}
                    {s.quedaTemp3h != null && s.quedaTemp3h >= 1 && <span>temp −{s.quedaTemp3h}°C/3h</span>}
                    {s.ventoKmh != null ? (
                      <span style={{ color: "#bfe3ff" }}>
                        💨 vento {s.ventoKmh} km/h{s.ventoCardinal ? ` de ${s.ventoCardinal}` : ""}
                        {s.rajadaKmh != null ? ` (raj. ${s.rajadaKmh})` : ""}
                        {s.ventoHora ? ` · ${s.ventoHora}${s.ventoIdadeMin != null ? ` (há ${s.ventoIdadeMin} min)` : ""}` : ""}
                      </span>
                    ) : (
                      <span style={{ opacity: 0.6 }}>💨 vento — sem leitura recente</span>
                    )}
                    {s.umidade != null && <span>umid. {s.umidade}%</span>}
                    {s.etaH != null && <span style={{ color: "#fde047" }}>chega à base ~{s.etaH} h</span>}
                    {s.idadeMin != null && <span style={{ opacity: 0.6 }}>há {s.idadeMin} min</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="legend-row" style={{ marginTop: 8 }}>
            <span>
              Pré-frontal: pressão caindo e vento de norte. Passando: vento vira para sul e esfria. ETA estimado com
              frente a ~30 km/h — é aproximado.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
