"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BASE, HOURS, MODELS, type ModelId } from "@/lib/config";
import { cardinal, type LayerWind } from "@/lib/wind";
import type { ForecastResponse, HourForecast } from "@/lib/openmeteo";
import type { DriftSeries } from "@/components/DriftMap";

const DriftMap = dynamic(() => import("@/components/DriftMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Carregando mapa…</div>,
});

const DAY_LABELS = ["Hoje", "Amanhã", "Dep. amanhã"];
const WHATSAPP = "https://wa.me/5527998373174";
const LOGO = "https://voepedraazul.com.br/wp-content/uploads/2025/10/Logo-voe-pa-2.png";

function dateForDay(offset: number): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  now.setDate(now.getDate() + offset);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function speedColor(kt: number) {
  if (kt < 7) return "#7ED957";
  if (kt < 12) return "#F5A623";
  return "#EF5D5D";
}

function shiftTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function verdict(layers: LayerWind[], surfaceKt: number | null) {
  const ops = layers.filter((l) => l.m <= 1000);
  const maxKt = Math.max(...ops.map((l) => l.kt));
  const sfc = surfaceKt ?? 0;
  if (sfc <= 5 && maxKt <= 10)
    return { label: "Bom para voar", hint: "Vento calmo nas camadas baixas.", color: "#7ED957" };
  if (sfc <= 8 && maxKt <= 15)
    return { label: "Atenção", hint: "Vento moderado — decisão do piloto.", color: "#F5A623" };
  return { label: "Não voar", hint: "Vento forte nas camadas baixas.", color: "#EF5D5D" };
}

function driftEndInfo(hour: HourForecast | undefined) {
  const end = hour?.drift.at(-1);
  if (!end) return null;
  const DEG = Math.PI / 180;
  const dy = (end.lat - BASE.lat) * 111_320;
  const dx = (end.lon - BASE.lon) * 111_320 * Math.cos(BASE.lat * DEG);
  const km = Math.hypot(dx, dy) / 1000;
  const bearing = (Math.atan2(dx, dy) / DEG + 360) % 360;
  return { km, bearing, dx, dy };
}

function Arrow({ to, size = 18 }: { to: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${to}deg)` }} aria-hidden>
      <path
        d="M12 2 L12 20 M12 2 L6 9 M12 2 L18 9"
        stroke="#EAF2FB"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Home() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(6);
  const [model, setModel] = useState<ModelId>("ecmwf_ifs025");
  const [mapFull, setMapFull] = useState(false);
  const fullRef = useRef<HTMLDivElement>(null);

  const closeFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setMapFull(false);
  }, []);

  // Em tela cheia: tenta fullscreen nativo + travar em paisagem (quando o celular permite)
  useEffect(() => {
    if (!mapFull) return;
    document.body.style.overflow = "hidden";
    const el = fullRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen()
        .then(() => {
          type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };
          (screen.orientation as LockableOrientation)?.lock?.("landscape").catch(() => {});
        })
        .catch(() => {});
    }
    const onFsChange = () => {
      if (!document.fullscreenElement) setMapFull(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, [mapFull]);

  useEffect(() => {
    fetch("/api/forecast")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const dateISO = dateForDay(day);
  const targetTime = `${dateISO}T${String(hour).padStart(2, "0")}:00`;

  const byModel = useMemo(() => {
    if (!data) return null;
    const out: Partial<Record<ModelId, HourForecast>> = {};
    for (const m of MODELS) out[m.id] = data.models[m.id]?.hours.find((h) => h.time === targetTime);
    return out;
  }, [data, targetTime]);

  const active = byModel?.[model] ?? byModel?.gfs_seamless;
  const activeMeta = MODELS.find((m) => m.id === model)!;

  const series: DriftSeries[] = MODELS.flatMap((m) => {
    const h = byModel?.[m.id];
    return h ? [{ label: m.label, color: m.color, drift: h.drift }] : [];
  });

  // Concordância: dispersão dos pontos finais das 3 trajetórias
  const agreement = useMemo(() => {
    if (!byModel) return null;
    const ends = MODELS.map((m) => driftEndInfo(byModel[m.id])).filter(Boolean) as {
      km: number;
      dx: number;
      dy: number;
    }[];
    if (ends.length < 2) return null;
    const avgKm = ends.reduce((a, e) => a + e.km, 0) / ends.length;
    let maxSep = 0;
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++)
        maxSep = Math.max(maxSep, Math.hypot(ends[i].dx - ends[j].dx, ends[i].dy - ends[j].dy) / 1000);
    const pct = Math.max(20, Math.min(100, Math.round(100 - (maxSep / Math.max(avgKm, 0.1)) * 100)));
    return { pct, avgKm, maxSep };
  }, [byModel]);

  const dateLabel = new Date(`${targetTime}:00-03:00`).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  });

  const sunrise = data?.sunrise?.[dateISO];

  return (
    <div>
      <header className="nav">
        <div className="wrap nav-inner">
          <a href="#topo" style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="Voe Pedra Azul" style={{ height: 44, width: "auto", display: "block" }} />
          </a>
          <nav className="nav-links">
            <a href="#previsao">Previsão</a>
            <a href="#modelos">Modelos</a>
            <a href="#sobre">Sobre</a>
            <a href="#contato">Contato</a>
          </nav>
          <a className="cta" href={WHATSAPP}>
            Reservar voo
          </a>
        </div>
      </header>

      <section id="topo" className="hero">
        <div className="hero-bg" />
        <div className="wrap hero-inner">
          <div className="badge">
            <span className="dot" />
            Base Pedra Azul · Domingos Martins — ES
          </div>
          <h1>
            Vento em camadas para o seu <em>próximo amanhecer</em>
          </h1>
          <p className="sub">
            Previsão do vento de 100 m a 1800 m acima do solo e a trajetória de deriva do balão nos modelos ECMWF,
            GFS e ICON — tudo em um só painel, com dados reais atualizados a cada 30 minutos.
          </p>

          {error && <p className="error">Erro ao carregar a previsão: {error}. Recarregue a página.</p>}

          <div className="status-grid">
            <div className="card">
              <div className="card-label">Condição de decolagem</div>
              {active ? (
                <>
                  <SemaphoreRow hour={active} />
                  <div className="facts-row">
                    <div className="fact">
                      <div className="k">Vento superfície</div>
                      <div className="v">
                        {active.surface ? `${active.surface.kt.toFixed(0)} kt ${cardinal(active.surface.from)}` : "—"}
                      </div>
                    </div>
                    <div className="fact">
                      <div className="k">Rajada máx.</div>
                      <div className="v">{active.gustKt !== null ? `${active.gustKt.toFixed(0)} kt` : "—"}</div>
                    </div>
                    <div className="fact">
                      <div className="k">Concordância</div>
                      <div className="v">{agreement ? `${agreement.pct}%` : "—"}</div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="loading">{data ? "Sem dados para este horário." : "Carregando previsão…"}</p>
              )}
            </div>

            <div className="card">
              <div className="card-label">Janela do voo</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
                <div className="chips">
                  {DAY_LABELS.map((label, i) => (
                    <button key={i} className={day === i ? "chip active" : "chip"} onClick={() => setDay(i)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="chips">
                  <span className="chips-label">manhã</span>
                  {HOURS.filter((h) => h < 12).map((h) => (
                    <button key={h} className={hour === h ? "chip active" : "chip"} onClick={() => setHour(h)}>
                      {String(h).padStart(2, "0")}h
                    </button>
                  ))}
                </div>
                <div className="chips">
                  <span className="chips-label">tarde</span>
                  {HOURS.filter((h) => h >= 12).map((h) => (
                    <button key={h} className={hour === h ? "chip active" : "chip"} onClick={() => setHour(h)}>
                      {String(h).padStart(2, "0")}h
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingTop: 8 }}>
        <div className="sun-grid">
          <div className="sun-card">
            <div className="k">Nascer do sol</div>
            <div className="v" style={{ color: "#F5A623" }}>
              {sunrise ?? "—"}
            </div>
            <div className="n">melhor luz e vento</div>
          </div>
          <div className="sun-card">
            <div className="k">Preparação</div>
            <div className="v" style={{ color: "#F5A623" }}>
              {sunrise ? shiftTime(sunrise, -30) : "—"}
            </div>
            <div className="n">inflar e checar o balão</div>
          </div>
          <div className="sun-card">
            <div className="k">Decolagem ideal</div>
            <div className="v" style={{ color: "#7ED957" }}>
              {sunrise ? shiftTime(sunrise, 10) : "—"}
            </div>
            <div className="n">brisa mais estável</div>
          </div>
          <div className="sun-card">
            <div className="k">Temp. prevista</div>
            <div className="v" style={{ color: "#57B7EA" }}>
              {active?.tempC != null ? `${active.tempC}°C` : "—"}
            </div>
            <div className="n">
              às {String(hour).padStart(2, "0")}h na base
            </div>
          </div>
        </div>
      </section>

      <section id="previsao" className="wrap" style={{ paddingTop: 56 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 22,
          }}
        >
          <div>
            <div className="kicker">Perfil vertical</div>
            <h2 className="section-title">Vento por camadas</h2>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Modelo em destaque: <strong style={{ color: "var(--text)" }}>{activeMeta.label}</strong> · {dateLabel} às{" "}
            {String(hour).padStart(2, "0")}:00
          </div>
        </div>

        <div className="layers-card">
          <div className="layer-head">
            <div>Altitude</div>
            <div>Dir</div>
            <div>Velocidade</div>
            <div style={{ textAlign: "right" }}>De → para</div>
          </div>
          {active?.surface && <LayerRow altLabel="Solo" ft={null} kt={active.surface.kt} from={active.surface.from} to={active.surface.to} />}
          {active?.layers.map((l) => (
            <LayerRow key={l.m} altLabel={`${l.m} m`} ft={l.ft} kt={l.kt} from={l.from} to={l.to} />
          ))}
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
            <span style={{ marginLeft: "auto" }}>Seta aponta para onde o balão vai · alturas acima da base (1062 m)</span>
          </div>
        </div>
      </section>

      <section id="modelos" className="wrap" style={{ paddingTop: 56 }}>
        <div className="kicker">Comparação de modelos</div>
        <h2 className="section-title" style={{ marginBottom: 22 }}>
          Trajetória de deriva
        </h2>

        <div className="models-grid">
          <div className="map-card">
            <div className="map-holder">
              {series.length > 0 ? (
                <DriftMap series={series} activeLabel={activeMeta.label} />
              ) : (
                <div className="map-loading">Carregando mapa…</div>
              )}
              {series.length > 0 && (
                <button className="map-expand" onClick={() => setMapFull(true)}>
                  ⛶ Tela cheia
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {MODELS.map((m) => {
              const info = driftEndInfo(byModel?.[m.id]);
              const isActive = model === m.id;
              return (
                <button
                  key={m.id}
                  className="model-card"
                  onClick={() => setModel(m.id)}
                  style={isActive ? { border: `1px solid ${m.color}`, background: "rgba(87,183,234,.08)" } : undefined}
                >
                  <div
                    className="model-badge"
                    style={
                      isActive
                        ? { background: m.color, color: "#0A1724" }
                        : { background: "rgba(87,183,234,.15)", color: m.color }
                    }
                  >
                    {m.abbr}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="model-name">{m.label}</div>
                    <div className="model-sub">{m.provider}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="model-num">{info ? `${info.km.toFixed(1)} km` : "—"}</div>
                    <div className="model-sub">{info ? `rumo ${cardinal(info.bearing)}` : ""}</div>
                  </div>
                </button>
              );
            })}
            <div className="summary-box">
              {agreement
                ? agreement.pct > 70
                  ? `Os três modelos concordam bem: deriva prevista de ~${agreement.avgKm.toFixed(1)} km até 1800 m. Alta confiança na trajetória.`
                  : `Os modelos divergem (dispersão de ${agreement.maxSep.toFixed(1)} km entre os pontos finais). Reavalie mais perto do horário do voo.`
                : "Selecione um horário com dados para comparar os modelos."}
            </div>
          </div>
        </div>
      </section>

      <section id="sobre" className="wrap" style={{ paddingTop: 72 }}>
        <div className="about-grid">
          <div>
            <div className="kicker">Quem somos</div>
            <h2 className="section-title" style={{ marginBottom: 18 }}>
              Pioneiros no balonismo capixaba
            </h2>
            <p>
              Fundada por apaixonados pela aviação, a Voe Pedra Azul foi a primeira empresa a trazer o balonismo para
              o Espírito Santo. Cada voo acontece dentro dos mais altos padrões de segurança — com pilotos
              credenciados, seguro para todos os passageiros e estrutura própria de hangar e apoio.
            </p>
            <p style={{ marginBottom: 26 }}>
              Esta ferramenta de previsão nasceu dessa mesma obsessão por segurança: só decolamos quando o céu está do
              nosso lado.
            </p>
            <div className="stats-row">
              <div className="stat">
                <div className="v">5,0</div>
                <div className="k">nota no Google</div>
              </div>
              <div className="stat">
                <div className="v">+1000</div>
                <div className="k">passageiros</div>
              </div>
              <div className="stat">
                <div className="v">30 min</div>
                <div className="k">de voo panorâmico</div>
              </div>
            </div>
          </div>
          <div className="about-img">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://voepedraazul.com.br/wp-content/uploads/2025/10/voo-coletivo.webp" alt="Voo de balão em Pedra Azul" />
          </div>
        </div>
      </section>

      <section id="contato" className="wrap" style={{ paddingTop: 72, paddingBottom: 20 }}>
        <div className="cta-panel">
          <div className="cta-bg" />
          <div style={{ position: "relative" }}>
            <h2 className="section-title" style={{ fontSize: "clamp(26px, 4vw, 36px)", marginBottom: 12 }}>
              O seu próximo amanhecer <em style={{ fontStyle: "italic", fontWeight: 600, color: "#F5A623" }}>te espera</em>
            </h2>
            <p style={{ maxWidth: 520, margin: "0 auto 28px", fontSize: 16, color: "#D3E2F0", lineHeight: 1.55 }}>
              A gente cuida de todo o resto: segurança, conforto e aquele toque de emoção que só um voo de balão pode
              oferecer.
            </p>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
              <a className="cta-big" href={WHATSAPP}>
                Agende seu voo
              </a>
              <a className="btn-ghost" href="https://www.instagram.com/voe.pedraazul/">
                Instagram
              </a>
            </div>
          </div>
        </div>
      </section>

      {mapFull && series.length > 0 && (
        <div className="map-full" ref={fullRef}>
          <DriftMap series={series} activeLabel={activeMeta.label} fullscreen />
          <button className="map-full-close" onClick={closeFull}>
            ✕ Fechar
          </button>
          <div className="map-full-hint">Arraste para mover · dois dedos para girar e ampliar</div>
        </div>
      )}

      <footer className="footer">
        <div className="wrap footer-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt="Voe Pedra Azul" style={{ height: 40 }} />
          <div>
            <div>+55 (27) 99837-3174</div>
            <div>Rua Nona Elvira Modolo, 72 · Domingos Martins — Pedra Azul, ES</div>
          </div>
          <div style={{ display: "flex", gap: 18, fontSize: 13, fontWeight: 600 }}>
            <a href="https://www.instagram.com/voe.pedraazul/">Instagram</a>
            <a href="https://www.facebook.com/p/Voe-pedra-Azul-61564707724214/">Facebook</a>
            <a href={WHATSAPP}>WhatsApp</a>
          </div>
        </div>
        <div className="footer-note">
          Previsão com dados reais Open-Meteo · ECMWF · GFS · ICON · Vento em camadas até 1800 m acima da base ·
          atualização a cada 30 min
          <br />
          ⚠️ Estimativa operacional — <b>confirmar localmente antes da decolagem. A decisão de voo é sempre do piloto.</b>
        </div>
      </footer>
    </div>
  );
}

function SemaphoreRow({ hour }: { hour: HourForecast }) {
  const v = verdict(hour.layers, hour.surface?.kt ?? null);
  return (
    <div className="sem-row">
      <div className="sem-chip" style={{ background: v.color }}>
        <span />
      </div>
      <div>
        <div className="sem-title">{v.label}</div>
        <div className="sem-hint">{v.hint}</div>
      </div>
    </div>
  );
}

function LayerRow({
  altLabel,
  ft,
  kt,
  from,
  to,
}: {
  altLabel: string;
  ft: number | null;
  kt: number;
  from: number;
  to: number;
}) {
  const pct = Math.min(100, (kt / 20) * 100);
  return (
    <div className="layer-row">
      <div className="layer-alt">
        {altLabel}
        {ft !== null && <small>{ft.toLocaleString("pt-BR")} ft</small>}
      </div>
      <div className="layer-arrow">
        <Arrow to={to} />
      </div>
      <div className="layer-bar-wrap">
        <div className="layer-bar">
          <i style={{ width: `${pct}%`, background: speedColor(kt) }} />
        </div>
        <div className="layer-kt">{kt.toFixed(1)} kt</div>
      </div>
      <div className="layer-dir">
        de {from}° → {to}° {cardinal(to)}
      </div>
    </div>
  );
}
