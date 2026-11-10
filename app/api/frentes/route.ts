import { NextRequest, NextResponse } from "next/server";
import { BASE, TIMEZONE } from "@/lib/config";
import { cardinal } from "@/lib/wind";
import {
  FRONT_KMH,
  UPSTREAM_MAX,
  UPSTREAM_MIN,
  analisa,
  escolheEstacoes,
  parseSerie,
  ultimoVento,
  type EstacaoInmet,
  type Ponto,
} from "@/lib/frentes";

// Monitor de frente fria: lê as estações automáticas do INMET a montante
// (sul/sudoeste) da base e diz se tem frente se aproximando, com ETA.

export const dynamic = "force-dynamic";

const INMET = "https://apitempo.inmet.gov.br";

async function fetchEstacoes(): Promise<EstacaoInmet[]> {
  const r = await fetch(`${INMET}/estacoes/T`, {
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`INMET estações HTTP ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

async function fetchSerie(cod: string, d1: string, d2: string): Promise<Ponto[]> {
  try {
    const r = await fetch(`${INMET}/estacao/${d1}/${d2}/${cod}`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok || r.status === 204) return [];
    return parseSerie(await r.json());
  } catch {
    return [];
  }
}

const isoUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const latQ = parseFloat(sp.get("lat") ?? "");
  const lonQ = parseFloat(sp.get("lon") ?? "");
  const lat = Number.isFinite(latQ) ? latQ : BASE.lat;
  const lon = Number.isFinite(lonQ) ? lonQ : BASE.lon;

  let lista: EstacaoInmet[];
  try {
    lista = await fetchEstacoes();
  } catch (e) {
    return NextResponse.json(
      { error: `INMET indisponível agora (${e instanceof Error ? e.message : "erro"})` },
      { status: 502 }
    );
  }

  const escolhidas = escolheEstacoes(lista, lat, lon);
  const agora = Date.now();
  // INMET usa datas em UTC; pegamos ontem + hoje para ter as últimas ~24 h
  const d1 = isoUtc(agora - 86400e3);
  const d2 = isoUtc(agora);
  const series = await Promise.all(escolhidas.map((c) => fetchSerie(c.e.CD_ESTACAO, d1, d2)));

  const estacoesOut = escolhidas.map((c, i) => {
    const serie = series[i];
    const a = analisa(serie, agora);
    const upstream = c.b >= UPSTREAM_MIN && c.b <= UPSTREAM_MAX;
    const ventoPt = ultimoVento(serie);
    const ventoIdadeMin = ventoPt ? Math.max(0, Math.round((agora - ventoPt.utcMs) / 60000)) : null;
    const ventoHora = ventoPt
      ? new Date(ventoPt.utcMs).toLocaleTimeString("pt-BR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" })
      : null;
    // ETA da frente até a base (só p/ estação a montante sentindo a frente)
    const etaH =
      upstream && (a.fase === "pre" || a.fase === "passagem" || a.fase === "pos")
        ? Math.round((c.d / FRONT_KMH) * 10) / 10
        : null;
    return {
      codigo: c.e.CD_ESTACAO,
      nome: c.e.DC_NOME,
      uf: c.e.SG_ESTADO,
      distKm: Math.round(c.d),
      rumo: Math.round(c.b),
      rumoCardinal: cardinal(c.b),
      upstream,
      fase: a.fase,
      giroVento: a.giroVento,
      pressaoHpa: a.last?.pressaoHpa ?? null,
      tendP3h: a.tendP3h,
      tempC: a.last?.tempC ?? null,
      quedaTemp3h: a.quedaTemp3h,
      ventoKmh: ventoPt?.ventoKmh ?? null,
      ventoDir: ventoPt?.ventoDir ?? null,
      ventoCardinal: ventoPt?.ventoDir != null ? cardinal(ventoPt.ventoDir) : null,
      rajadaKmh: ventoPt?.rajadaKmh ?? null,
      ventoHora,
      ventoIdadeMin,
      umidade: a.last?.umidade ?? null,
      idadeMin: a.idadeMin,
      etaH,
    };
  });

  // resumo geral
  const local = estacoesOut[0];
  const sentindo = estacoesOut.filter((s) => s.upstream && (s.fase === "passagem" || s.fase === "pos"));
  const pre = estacoesOut.filter((s) => s.upstream && s.fase === "pre");
  let nivel: "sem_dados" | "sem_sinal" | "monitorar" | "chegando" | "passando";
  let texto: string;
  let etaH: number | null = null;
  if (estacoesOut.every((s) => s.fase === "sem_dados")) {
    nivel = "sem_dados";
    texto = "As estações do INMET não mandaram dados agora.";
  } else if (local && local.fase === "passagem" && local.distKm < 60) {
    nivel = "passando";
    texto = `Frente passando agora perto da base (${local.nome}): vento virou para o sul e/ou a temperatura caiu.`;
  } else if (sentindo.length) {
    const prox = sentindo.reduce((a, b) => (a.distKm < b.distKm ? a : b));
    etaH = prox.etaH;
    nivel = "chegando";
    texto = `Frente fria já em ${prox.nome}/${prox.uf} (${prox.distKm} km a ${prox.rumoCardinal}). Chega à base em ~${prox.etaH} h.`;
  } else if (pre.length) {
    nivel = "monitorar";
    texto = `Sinais de pré-frontal (pressão caindo, vento de norte) em ${pre.length} estação(ões) a sul/sudoeste. Acompanhe.`;
  } else {
    nivel = "sem_sinal";
    texto = "Nenhum sinal de frente fria nas estações a sul/sudoeste.";
  }

  return NextResponse.json({
    atualizadoEm: new Date(agora).toISOString(),
    frontKmh: FRONT_KMH,
    resumo: { nivel, texto, etaH },
    estacoes: estacoesOut,
  });
}
