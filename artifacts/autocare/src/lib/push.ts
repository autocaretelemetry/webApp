// Client-side web-push registration helpers.
import {
  getVapidPublicKey,
  createPushSubscription,
  deletePushSubscription,
} from "@workspace/api-client-react";

const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

function base64UrlToUint8(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function pushPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_URL);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL);
  } catch {
    return null;
  }
}

export async function subscribeOwnerToPush(
  ownerPhone: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "permission_denied" };

  const reg = await ensureServiceWorker();
  if (!reg) return { ok: false, reason: "sw_failed" };

  let vapidPublicKey: string;
  try {
    const v = await getVapidPublicKey();
    vapidPublicKey = v.publicKey;
  } catch {
    return { ok: false, reason: "vapid_unavailable" };
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8(vapidPublicKey),
      });
    } catch {
      return { ok: false, reason: "subscribe_failed" };
    }
  }

  const json = sub.toJSON();
  const keys = json.keys || {};
  if (!json.endpoint || !keys["p256dh"] || !keys["auth"]) {
    return { ok: false, reason: "subscribe_failed" };
  }

  try {
    await createPushSubscription({
      ownerPhone,
      endpoint: json.endpoint,
      p256dh: keys["p256dh"],
      auth: keys["auth"],
      userAgent: navigator.userAgent,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "register_failed" };
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    /* ignore */
  }
  try {
    await deletePushSubscription({ endpoint });
  } catch {
    /* ignore */
  }
}
