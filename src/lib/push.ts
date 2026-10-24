import { getAuthHeaders } from "@/lib/supabase/client";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export type PushState = "unsupported" | "unconfigured" | "denied" | "needs-permission" | "needs-subscription" | "subscribed";

/**
 * Checks whether this browser already has a live push subscription, without
 * prompting for anything. Used to decide what to show in the notifications UI.
 */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "needs-permission";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? "subscribed" : "needs-subscription";
  } catch {
    return "needs-subscription";
  }
}

/**
 * Requests permission (if needed) and (re)creates the push subscription,
 * saving it server-side. Safe to call again after a prior attempt failed —
 * e.g. permission was already granted but the subscribe() call itself
 * failed to reach the browser's push service (poor signal, battery saver,
 * a flaky connection). Never throws; reports failure via the return value.
 */
export async function enablePushNotifications(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: "Push notifications aren't supported in this browser." };
  if (!VAPID_PUBLIC_KEY) return { ok: false, error: "Push notifications aren't set up on this server yet." };

  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        ok: false,
        error:
          permission === "denied"
            ? "Notifications are blocked for this site. Enable them in your browser's site settings, then try again."
            : "Notification permission was not granted.",
      };
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    const json = subscription.toJSON();
    const res = await fetch("/api/notifications/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (!res.ok) return { ok: false, error: "Could not save your subscription. Please try again." };
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message ? `Could not enable notifications: ${err.message}` : "Could not connect to the browser's notification service. Check your connection and try again.",
    };
  }
}
