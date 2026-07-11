import webpush from "web-push";
import crypto from "crypto";
import { saveText, listJson, deleteObject } from "./store";

// Web Push (notificação com o app fechado). As assinaturas ficam no store
// (Blob em produção, ./.data em dev), cada uma com a localização a monitorar.

export interface PushSub {
  id: string;
  subscription: webpush.PushSubscription;
  lat: number;
  lon: number;
  lastStatus?: string; // último status alertado, para não repetir a notificação
  updatedAt: string;
}

let configured: boolean | null = null;
function ensureConfig(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@voepedraazul.com.br";
  configured = !!(pub && priv);
  if (configured) webpush.setVapidDetails(subject, pub!, priv!);
  return configured;
}

export function pushConfigured(): boolean {
  return ensureConfig();
}

export function subId(endpoint: string): string {
  return crypto.createHash("sha1").update(endpoint).digest("hex").slice(0, 16);
}

export async function saveSub(
  subscription: webpush.PushSubscription,
  lat: number,
  lon: number
): Promise<PushSub> {
  const id = subId(subscription.endpoint);
  const rec: PushSub = { id, subscription, lat, lon, updatedAt: new Date().toISOString() };
  await saveText(`push/${id}.json`, JSON.stringify(rec), "application/json");
  return rec;
}

export async function listSubs(): Promise<PushSub[]> {
  return listJson<PushSub>("push/");
}

export async function updateSub(rec: PushSub, lastStatus: string): Promise<void> {
  rec.lastStatus = lastStatus;
  rec.updatedAt = new Date().toISOString();
  await saveText(`push/${rec.id}.json`, JSON.stringify(rec), "application/json");
}

export async function sendPush(rec: PushSub, title: string, body: string): Promise<boolean> {
  if (!ensureConfig()) return false;
  try {
    await webpush.sendNotification(rec.subscription, JSON.stringify({ title, body }));
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    // 404/410 = assinatura expirada/cancelada → remove
    if (status === 404 || status === 410) await deleteObject(`push/${rec.id}.json`);
    return false;
  }
}
