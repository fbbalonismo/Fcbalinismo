import { NextRequest, NextResponse } from "next/server";
import { saveSub, pushConfigured } from "@/lib/push";

// Registra a assinatura de Web Push do navegador + a localização a monitorar.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!pushConfigured()) {
      return NextResponse.json({ error: "Web Push não configurado no servidor" }, { status: 503 });
    }
    const body = await req.json();
    const subscription = body?.subscription;
    const lat = Number(body?.lat);
    const lon = Number(body?.lon);
    if (!subscription?.endpoint || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "Dados de assinatura inválidos" }, { status: 400 });
    }
    const rec = await saveSub(subscription, lat, lon);
    return NextResponse.json({ ok: true, id: rec.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao assinar" },
      { status: 500 }
    );
  }
}
