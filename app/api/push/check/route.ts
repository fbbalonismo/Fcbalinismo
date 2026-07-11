import { NextRequest, NextResponse } from "next/server";
import { listSubs, updateSub, sendPush } from "@/lib/push";
import { assessRain } from "@/lib/rain/assess";
import { RAIN_LABELS } from "@/lib/rain/scale";

// Checagem periódica (cron): para cada assinatura, avalia a chuva na localização
// e envia uma notificação quando o status muda para chuva/aproximação. Chamado
// pelo cron da Vercel (vercel.json) ou manualmente com o segredo.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.PUSH_CRON_SECRET;
  if (!secret) return true; // sem segredo definido = aberto (dev)
  const auth = req.headers.get("authorization");
  const cron = process.env.CRON_SECRET;
  if (cron && auth === `Bearer ${cron}`) return true; // cron da Vercel
  return req.nextUrl.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  try {
    const subs = await listSubs();
    let sent = 0;

    await Promise.all(
      subs.map(async (rec) => {
        const a = await assessRain(rec.lat, rec.lon);
        const alertable = a.raining || a.approaching;
        // chave do evento: status atual (só notifica quando MUDA)
        const eventKey = alertable ? a.status : "sem";
        if (eventKey === rec.lastStatus) return;

        if (alertable) {
          const body = a.approaching
            ? `Nuvem de chuva chegando em ~${a.etaMin} min na sua localização.`
            : `Está chovendo (${RAIN_LABELS[a.status]}) na sua localização.`;
          const ok = await sendPush(rec, "🌧️ Alerta de chuva — Voe Pedra Azul", body);
          if (ok) sent++;
        }
        await updateSub(rec, eventKey);
      })
    );

    return NextResponse.json({ ok: true, checked: subs.length, sent });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro na checagem" },
      { status: 500 }
    );
  }
}
