"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BASE, HOURS, MODELS, type ModelId } from "@/lib/config";
import { cardinal, ktToKmh, type LayerWind } from "@/lib/wind";
import type { PickedLoc } from "@/components/LocationPicker";
import type { ForecastResponse, HourForecast } from "@/lib/openmeteo";
import type { DriftSeries } from "@/components/DriftMap";
import type { FlightAnalysis } from "@/lib/gpx";
import { RAIN_LABELS } from "@/lib/rain/scale";
import type { RainAssessment } from "@/lib/rain/types";
import Assistant from "@/components/Assistant";

interface RainData {
  totalRegistros: number;
  placar: Record<string, { acertos: number; total: number }>;
}
interface FlightsData {
  flights: FlightAnalysis[];
  totalVoos: number;
  media: Record<string, { dirErr: number; speedBias: number; voos: number }>;
}
// Escala observável no solo (card "Está chovendo agora?")
const INTENSITIES = (["sem", "sereno", "leve", "moderada", "intensa"] as const).map((id) => ({
  id,
  label: RAIN_LABELS[id],
}));
// Escala do alerta (inclui "aproximação de nuvem")
const CONFIRM_LEVELS = ["sem", "sereno", "aproximacao", "leve", "moderada", "intensa"] as const;

const DriftMap = dynamic(() => import("@/components/DriftMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Carregando mapa…</div>,
});

const LocationPicker = dynamic(() => import("@/components/LocationPicker"), {
  ssr: false,
  loading: () => <div className="picker-overlay map-loading">Carregando…</div>,
});

const DAY_LABELS = ["Hoje", "Amanhã", "Dep. amanhã"];
const WHATSAPP = "https://wa.me/5527998373174";
const LOGO = "https://voepedraazul.com.br/wp-content/uploads/2025/10/Logo-voe-pa-2.png";

// Converte a chave pública VAPID (base64url) para o formato que o PushManager espera
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

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

// Classifica nevoeiro / névoa baixa a partir dos sinais do modelo.
// "nevoeiro" = visibilidade < 1 km (ou código WMO 45/48) — névoa baixa em solo;
// "nevoa" = visibilidade reduzida (< 4 km) ou quase saturado com nuvem baixa densa.
function fogLevel(h: HourForecast | undefined): "nevoeiro" | "nevoa" | null {
  if (!h) return null;
  const { weatherCode: code, visibilityM: vis, rhPct: rh, cloudLowPct: low, tempC, dewC } = h;
  const spread = tempC != null && dewC != null ? tempC - dewC : null;
  if (code === 45 || code === 48 || (vis != null && vis < 1000)) return "nevoeiro";
  if (
    (vis != null && vis < 4000) ||
    (rh != null && rh >= 96 && low != null && low >= 80 && (spread == null || spread <= 1.5))
  )
    return "nevoa";
  return null;
}

function driftEndInfo(hour: HourForecast | undefined, origin: { lat: number; lon: number }) {
  const end = hour?.drift.at(-1);
  if (!end) return null;
  const DEG = Math.PI / 180;
  const dy = (end.lat - origin.lat) * 111_320;
  const dx = (end.lon - origin.lon) * 111_320 * Math.cos(origin.lat * DEG);
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
  const [rain, setRain] = useState<RainData | null>(null);
  const [rainMsg, setRainMsg] = useState<string | null>(null);
  const [flights, setFlights] = useState<FlightsData | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loc, setLoc] = useState<PickedLoc | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Alerta de chuva (nowcast na localização de abertura do app)
  const [alertLoc, setAlertLoc] = useState<{ lat: number; lon: number; name?: string } | null>(null);
  const [nowcast, setNowcast] = useState<RainAssessment | null>(null);
  const [alertActive, setAlertActive] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");
  const lastAlertKey = useRef<string>("");
  const confirmRef = useRef<HTMLDivElement>(null);

  // Restaura o último local escolhido
  useEffect(() => {
    try {
      const s = localStorage.getItem("voe-loc");
      if (s) setLoc(JSON.parse(s));
    } catch {}
  }, []);

  const selectLoc = useCallback((l: PickedLoc | null) => {
    setLoc(l);
    setPickerOpen(false);
    try {
      if (l) localStorage.setItem("voe-loc", JSON.stringify(l));
      else localStorage.removeItem("voe-loc");
    } catch {}
  }, []);

  const loadRain = useCallback(() => {
    fetch("/api/chuva")
      .then((r) => r.json())
      .then((d) => setRain(d && !d.error ? d : null))
      .catch(() => {});
  }, []);
  const loadFlights = useCallback(() => {
    fetch("/api/voos")
      .then((r) => r.json())
      .then((d) => setFlights(d && !d.error ? d : null))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadRain();
    loadFlights();
  }, [loadRain, loadFlights]);

  // Ao abrir o app: captura a localização do usuário (para o alerta de chuva)
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPerm(Notification.permission);
    }
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setAlertLoc({ lat: p.coords.latitude, lon: p.coords.longitude, name: "Sua localização" }),
        () => setAlertLoc(null), // negado/indisponível → usa local escolhido ou a base
        { timeout: 8000, maximumAge: 300000 }
      );
    }
  }, []);

  // Ponto monitorado: localização do usuário › local escolhido › base
  const monitorLat = alertLoc?.lat ?? loc?.lat ?? BASE.lat;
  const monitorLon = alertLoc?.lon ?? loc?.lon ?? BASE.lon;

  // Nowcast: consulta agora e a cada 5 min
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch(`/api/nowcast?lat=${monitorLat}&lon=${monitorLon}`);
        const j = await r.json();
        if (alive && !j.error) setNowcast(j);
      } catch {}
    };
    check();
    const id = setInterval(check, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [monitorLat, monitorLon]);

  // Dispara alerta (banner + notificação) quando chove ou nuvem se aproxima
  useEffect(() => {
    if (!nowcast) return;
    if (!nowcast.raining && !nowcast.approaching) {
      setAlertActive(false);
      return;
    }
    // Chave estável por status+eta e janela de 10 min, para não repetir a notificação
    const bucket = Math.round(new Date(nowcast.checkedAt).getTime() / (10 * 60 * 1000));
    const key = `${nowcast.status}-${nowcast.etaMin ?? ""}-${bucket}`;
    setAlertActive(true);
    if (key !== lastAlertKey.current) {
      lastAlertKey.current = key;
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        const body = nowcast.approaching
          ? `Nuvem de chuva chegando em ~${nowcast.etaMin} min na sua localização.`
          : `Está chovendo (${RAIN_LABELS[nowcast.status]}) na sua localização.`;
        try {
          new Notification("🌧️ Alerta de chuva — Voe Pedra Azul", { body });
        } catch {}
      }
    }
  }, [nowcast]);

  const enableNotifications = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setNotifPerm(perm);
      if (perm !== "granted") return;
      // Assina Web Push para receber alertas com o app fechado
      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapid || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub, lat: monitorLat, lon: monitorLon }),
      });
    } catch {}
  }, [monitorLat, monitorLon]);

  const registerRain = useCallback(
    async (intensity: string, at?: { lat: number; lon: number }) => {
      setBusy(true);
      setRainMsg(null);
      try {
        const r = await fetch("/api/chuva", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intensity, ...(at ?? {}) }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setRainMsg(
          `✓ Registrado: ${RAIN_LABELS[intensity as keyof typeof RAIN_LABELS] ?? intensity} às ${j.record.time.slice(11)}`
        );
        loadRain();
      } catch (e) {
        setRainMsg(`Erro ao registrar: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(false);
      }
    },
    [loadRain]
  );

  const confirmAlert = useCallback(
    (level: string) => {
      registerRain(level, { lat: monitorLat, lon: monitorLon });
      setAlertActive(false);
    },
    [registerRain, monitorLat, monitorLon]
  );

  const uploadGpx = useCallback(
    async (file: File) => {
      setBusy(true);
      setUploadMsg("Analisando o voo…");
      try {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/voos", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        const a: FlightAnalysis = j.analysis;
        setUploadMsg(
          j.aviso ??
            `✓ Voo de ${a.startLocal.slice(0, 10).split("-").reverse().join("/")} analisado: máx ${a.maxAglM} m, ${a.distanceKm} km. Melhor direção: ${a.bestDirection} · melhor intensidade: ${a.bestSpeed}.`
        );
        loadFlights();
      } catch (e) {
        setUploadMsg(`Erro: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(false);
      }
    },
    [loadFlights]
  );

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
    setData(null);
    setError(null);
    const url = loc
      ? `/api/forecast?lat=${loc.lat}&lon=${loc.lon}&name=${encodeURIComponent(loc.name)}`
      : "/api/forecast";
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [loc]);

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
    if (!byModel || !data) return null;
    const ends = MODELS.map((m) => driftEndInfo(byModel[m.id], data.base)).filter(Boolean) as {
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
  }, [byModel, data]);

  // Alertas da condição de decolagem: chuva na janela ±2 h do horário, e
  // nevoeiro/névoa baixa (no amanhecer 4h–8h e junto ao horário do voo).
  const takeoffAlerts = useMemo(() => {
    if (!data) return [] as { level: "warn" | "danger"; text: string }[];
    const alerts: { level: "warn" | "danger"; text: string }[] = [];
    const hourAt = (hh: number, mid: ModelId) =>
      hh >= 0 && hh <= 23
        ? data.models[mid]?.hours.find((x) => x.time === `${dateISO}T${String(hh).padStart(2, "0")}:00`)
        : undefined;
    const hhLabel = (hs: number[]) => hs.map((h) => `${h}h`).join(", ");

    // 1) Chuva na janela ±2 h do horário escolhido (qualquer modelo com ≥ 0,2 mm/h)
    const rainHits: number[] = [];
    for (let hh = hour - 2; hh <= hour + 2; hh++) {
      if (MODELS.some((m) => (hourAt(hh, m.id)?.precipMm ?? 0) >= 0.2)) rainHits.push(hh);
    }
    if (rainHits.length) {
      alerts.push({
        level: "warn",
        text: `🌧️ Possibilidade de chuva na janela do voo (±2 h): previsão de precipitação às ${hhLabel(rainHits)}. Reavalie perto da hora.`,
      });
    }

    // 2) Nevoeiro / névoa baixa no amanhecer (4h–8h), qualquer modelo
    const worstFog = (hh: number): "nevoeiro" | "nevoa" | null => {
      let worst: "nevoeiro" | "nevoa" | null = null;
      for (const m of MODELS) {
        const lvl = fogLevel(hourAt(hh, m.id));
        if (lvl === "nevoeiro") return "nevoeiro";
        if (lvl === "nevoa") worst = "nevoa";
      }
      return worst;
    };
    const dawn: { hh: number; lvl: "nevoeiro" | "nevoa" }[] = [];
    for (let hh = 4; hh <= 8; hh++) {
      const lvl = worstFog(hh);
      if (lvl) dawn.push({ hh, lvl });
    }
    if (dawn.length) {
      const heavy = dawn.some((d) => d.lvl === "nevoeiro");
      alerts.push({
        level: heavy ? "danger" : "warn",
        text: `🌫️ ${heavy ? "Nevoeiro" : "Névoa baixa"} previsto no amanhecer (${hhLabel(dawn.map((d) => d.hh))}). Visibilidade reduzida entre 4h e 8h — confirme visualmente antes de inflar.`,
      });
    }

    // 3) Névoa baixa EM SOLO (nevoeiro) na janela ±2 h do horário, fora do amanhecer
    const groundFog: number[] = [];
    for (let hh = hour - 2; hh <= hour + 2; hh++) {
      if (hh >= 4 && hh <= 8) continue; // já coberto pelo alerta do amanhecer
      if (worstFog(hh) === "nevoeiro") groundFog.push(hh);
    }
    if (groundFog.length) {
      alerts.push({
        level: "danger",
        text: `🌫️ Névoa baixa em solo prevista perto do horário do voo (${hhLabel(groundFog)}). Piloto: avalie a visibilidade real e adie a decolagem se necessário.`,
      });
    }

    return alerts;
  }, [data, dateISO, hour]);

  const dateLabel = new Date(`${targetTime}:00-03:00`).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  });

  const sunrise = data?.sunrise?.[dateISO];
  const sunset = data?.sunset?.[dateISO];

  // Resumo das apurações atuais, passado ao assistente Claude como contexto
  const assistantContext = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Local: ${loc?.name ?? data?.base?.name ?? "Base Pedra Azul"}.`);
    parts.push(`Hora selecionada no app: ${dateLabel} ${targetTime.slice(11)}h · modelo em destaque: ${model}.`);
    if (data) {
      parts.push(
        `Previsão atualizada em ${new Date(data.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Modelos comparados: ECMWF, GFS, ICON.`
      );
    }
    if (nowcast) {
      const src = nowcast.sources.filter((s) => s.ok).map((s) => s.source).join(", ");
      const eta = nowcast.approaching && nowcast.etaMin != null ? ` (chega em ~${nowcast.etaMin} min)` : "";
      parts.push(`Nowcast de chuva agora: ${RAIN_LABELS[nowcast.status]}${eta}. Fontes ativas: ${src || "—"}.`);
    }
    return parts.join("\n");
  }, [loc, data, dateLabel, targetTime, model, nowcast]);

  // Precipitação hora a hora do dia selecionado, por modelo
  const rainHours = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const t = `${dateISO}T${String(h).padStart(2, "0")}:00`;
      const vals = MODELS.map((m) => data.models[m.id]?.hours.find((x) => x.time === t)?.precipMm ?? null);
      return { h, vals };
    });
  }, [data, dateISO]);
  const maxMm = Math.max(0.6, ...rainHours.flatMap((r) => r.vals.map((v) => v ?? 0)));
  const dayTotals = MODELS.map((_, i) =>
    Math.round(rainHours.reduce((a, r) => a + (r.vals[i] ?? 0), 0) * 10) / 10
  );

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
            <a href="#chuva">Chuva</a>
            <a href="#modelos">Modelos</a>
            <a href="#voos">Voos</a>
            <a href="#sobre">Sobre</a>
          </nav>
          <a className="cta" href={WHATSAPP}>
            Reservar voo
          </a>
        </div>
      </header>

      {alertActive && nowcast && (
        <div className="rain-alert" role="alert">
          <div className="wrap rain-alert-inner">
            <div className="rain-alert-head">
              <span className="rain-alert-icon">🌧️</span>
              <div style={{ flex: 1 }}>
                <strong>
                  {nowcast.approaching
                    ? `Nuvem de chuva chegando em ~${nowcast.etaMin} min`
                    : `Está chovendo agora — ${RAIN_LABELS[nowcast.status]}`}
                </strong>
                <div className="rain-alert-sub">
                  na {alertLoc?.name ?? "sua localização"} · detectado por:{" "}
                  {nowcast.sources
                    .filter((s) => s.ok && (nowcast.raining ? s.rainingNow : s.etaMin != null))
                    .map((s) => s.source)
                    .join(", ") || "—"}
                </div>
              </div>
              <button className="rain-alert-x" onClick={() => setAlertActive(false)} aria-label="Fechar">
                ×
              </button>
            </div>
            <div className="rain-alert-confirm">
              <span className="rain-alert-q">O que você vê aí?</span>
              <div className="rain-alert-chips">
                {CONFIRM_LEVELS.map((lv) => (
                  <button key={lv} className="chip" disabled={busy} onClick={() => confirmAlert(lv)}>
                    {RAIN_LABELS[lv]}
                  </button>
                ))}
              </div>
            </div>
            {notifPerm !== "granted" && (
              <button className="rain-alert-notif" onClick={enableNotifications}>
                🔔 Ativar notificações no navegador
              </button>
            )}
          </div>
        </div>
      )}

      <section id="topo" className="hero">
        <div className="hero-bg" />
        <div className="wrap hero-inner">
          <div className="badge">
            <span className="dot" />
            {loc ? loc.name : "Base Pedra Azul · Domingos Martins — ES"}
            {data ? ` · ${Math.round(data.elevation)} m` : ""}
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
                        {active.surface
                          ? `${ktToKmh(active.surface.kt).toFixed(0)} km/h ${cardinal(active.surface.from)}`
                          : "—"}
                      </div>
                    </div>
                    <div className="fact">
                      <div className="k">Rajada máx.</div>
                      <div className="v">{active.gustKt !== null ? `${ktToKmh(active.gustKt).toFixed(0)} km/h` : "—"}</div>
                    </div>
                    <div className="fact">
                      <div className="k">Concordância</div>
                      <div className="v">{agreement ? `${agreement.pct}%` : "—"}</div>
                    </div>
                  </div>
                  {takeoffAlerts.length > 0 && (
                    <div className="takeoff-alerts">
                      {takeoffAlerts.map((a, i) => (
                        <div key={i} className={`takeoff-alert ${a.level}`}>
                          {a.text}
                        </div>
                      ))}
                    </div>
                  )}
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
                <div className="chips">
                  <button className="chip loc-chip" onClick={() => setPickerOpen(true)}>
                    📍 {loc ? "Trocar local de decolagem" : "Escolher outro local de decolagem"}
                  </button>
                  {loc && (
                    <button className="chip" onClick={() => selectLoc(null)}>
                      ↩ Voltar para Pedra Azul
                    </button>
                  )}
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
            <div className="k">Pôr do sol</div>
            <div className="v" style={{ color: "#F5A623" }}>
              {sunset ?? "—"}
            </div>
            <div className="n">janela da tarde fecha antes</div>
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

      <section id="chuva" className="wrap" style={{ paddingTop: 56 }}>
        <div className="kicker">Precipitação</div>
        <h2 className="section-title" style={{ marginBottom: 22 }}>
          Chuva — os 3 modelos comparados
        </h2>

        <div className="layers-card" style={{ padding: "18px 18px 14px" }}>
          <div className="rain-legend">
            {MODELS.map((m, i) => (
              <span key={m.id}>
                <i style={{ background: m.color }} /> {m.label} · {dayTotals[i].toFixed(1)} mm no dia
              </span>
            ))}
          </div>
          <div className="rain-chart">
            {dayTotals.every((t) => t === 0) && (
              <div className="rain-dry">☀️ Nenhum modelo prevê chuva neste dia</div>
            )}
            {rainHours.map(({ h, vals }) => (
              <div
                key={h}
                className="rain-col"
                title={`${String(h).padStart(2, "0")}h — ${MODELS.map((m, i) => `${m.label}: ${(vals[i] ?? 0).toFixed(1)} mm`).join(" · ")}`}
              >
                <div className="rain-bars">
                  {vals.map((v, i) => (
                    <i
                      key={i}
                      style={{ height: `${Math.min(100, ((v ?? 0) / maxMm) * 100)}%`, background: MODELS[i].color }}
                    />
                  ))}
                </div>
                <span>{h % 3 === 0 ? `${h}h` : ""}</span>
              </div>
            ))}
          </div>
          <div className="rain-note">
            mm de chuva previstos por hora em {dateLabel} · barras por modelo · toque numa hora para ver os valores
          </div>
        </div>

        <div className="obs-grid">
          <div className="card">
            <div className="card-label">Está chovendo agora na base?</div>
            <p className="obs-help">
              Registre o que você está vendo — cada registro guarda também o que os 3 modelos previam para esta hora.
            </p>
            <div className="chips">
              {INTENSITIES.map((i) => (
                <button key={i.id} className="chip" disabled={busy} onClick={() => registerRain(i.id)}>
                  {i.label}
                </button>
              ))}
            </div>
            {rainMsg && <p className="obs-msg">{rainMsg}</p>}
          </div>

          <div className="card">
            <div className="card-label">
              Placar de realismo · {rain?.totalRegistros ?? 0} {(rain?.totalRegistros ?? 0) === 1 ? "registro" : "registros"}
            </div>
            {rain && rain.totalRegistros > 0 ? (
              <div className="placar">
                {MODELS.map((m) => {
                  const p = rain.placar?.[m.label];
                  const pct = p && p.total > 0 ? Math.round((p.acertos / p.total) * 100) : 0;
                  return (
                    <div key={m.id} className="placar-row">
                      <span className="placar-name" style={{ color: m.color }}>
                        {m.label}
                      </span>
                      <div className="placar-bar">
                        <i style={{ width: `${pct}%`, background: m.color }} />
                      </div>
                      <span className="placar-num">
                        {p ? `${p.acertos}/${p.total}` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="obs-help">Ainda sem registros — comece hoje!</p>
            )}
            <p className="obs-help" style={{ marginTop: 10 }}>
              Com ~1 mês de registros dá para dizer qual modelo é o mais realista aqui na região.
            </p>
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
              {series.length > 0 && data ? (
                <DriftMap series={series} activeLabel={activeMeta.label} origin={data.base} showRefs={!loc} />
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
              const info = data ? driftEndInfo(byModel?.[m.id], data.base) : null;
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

      <section id="voos" className="wrap" style={{ paddingTop: 56 }}>
        <div className="kicker">Pós-voo</div>
        <h2 className="section-title" style={{ marginBottom: 22 }}>
          Envie o GPX do seu voo
        </h2>

        <div className="obs-grid">
          <div className="card">
            <div className="card-label">Enviar arquivo do voo</div>
            <p className="obs-help">
              Envie a trilha do voo em <b>GPX</b> (Wikiloc), <b>KML/KMZ</b> (HotAir) ou <b>IGC</b> (Kubicek Flymate).
              Envie até 2 dias depois do voo — a ferramenta compara o traçado real com a previsão dos 3 modelos, faixa
              por faixa de altitude, e guarda tudo no histórico.
            </p>
            <label className={busy ? "upload-btn disabled" : "upload-btn"}>
              📂 Escolher arquivo .gpx, .kml, .kmz ou .igc
              <input
                type="file"
                accept=".gpx,.kml,.kmz,.igc,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadGpx(f);
                  e.target.value = "";
                }}
              />
            </label>
            {uploadMsg && <p className="obs-msg">{uploadMsg}</p>}
          </div>

          <div className="card">
            <div className="card-label">
              Média acumulada · {flights?.totalVoos ?? 0} {(flights?.totalVoos ?? 0) === 1 ? "voo" : "voos"}
            </div>
            {flights?.media && Object.keys(flights.media).length > 0 ? (
              <div className="placar">
                {MODELS.map((m) => {
                  const s = flights.media[m.label];
                  return (
                    <div key={m.id} className="placar-row">
                      <span className="placar-name" style={{ color: m.color }}>
                        {m.label}
                      </span>
                      <span className="placar-num" style={{ width: "auto", flex: 1, textAlign: "right" }}>
                        {s ? `direção ±${s.dirErr}° · vento ${s.speedBias > 0 ? "+" : ""}${ktToKmh(s.speedBias).toFixed(0)} km/h` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="obs-help">Nenhum voo analisado ainda.</p>
            )}
            <p className="obs-help" style={{ marginTop: 10 }}>
              Vento negativo = o modelo subestimou. A cada voo enviado a média melhora — é a calibração automática da
              ferramenta.
            </p>
          </div>
        </div>

        {flights?.flights && flights.flights.length > 0 && (
          <div className="flight-list">
            {flights.flights.map((f) => (
              <div key={f.startLocal} className="flight-row">
                <div>
                  <b>{f.startLocal.slice(0, 10).split("-").reverse().join("/")}</b>{" "}
                  <span className="obs-help">
                    {f.startLocal.slice(11)}–{f.endLocal.slice(11)}
                  </span>
                </div>
                <div className="obs-help">
                  máx {f.maxAglM} m · {f.distanceKm} km
                </div>
                <div className="obs-help">
                  {f.bestDirection ? (
                    <>
                      direção: <b>{f.bestDirection}</b> · vento: <b>{f.bestSpeed}</b>
                    </>
                  ) : (
                    "sem comparação (fora do alcance)"
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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

      {mapFull && series.length > 0 && data && (
        <div className="map-full" ref={fullRef}>
          <DriftMap series={series} activeLabel={activeMeta.label} fullscreen origin={data.base} showRefs={!loc} />
          <button className="map-full-close" onClick={closeFull}>
            ✕ Fechar
          </button>
          <div className="map-full-hint">Arraste para mover · dois dedos para girar e ampliar</div>
        </div>
      )}

      {pickerOpen && <LocationPicker onSelect={selectLoc} onClose={() => setPickerOpen(false)} />}

      <Assistant context={assistantContext} />

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
        <div className="layer-kt">{ktToKmh(kt).toFixed(0)} km/h</div>
      </div>
      <div className="layer-dir">
        de {from}° → {to}° {cardinal(to)}
      </div>
    </div>
  );
}
