import webpush from "web-push";
import type { ApiActor } from "@/lib/apiAuth";

type Service = ApiActor["service"];

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:noreply@gracemarkportal.com.ng";

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
}

export interface NotifyEntry {
  /** Dot-namespaced event key, e.g. "scores.submit", "results.approve". */
  type: string;
  title: string;
  body: string;
  /** In-app path to open when the notification is clicked, e.g. "/admin/approvals". */
  link?: string;
  metadata?: Record<string, unknown>;
}

/** Sends one push message to a subscription; drops the subscription if the browser reports it gone. */
async function pushOne(service: Service, sub: { id: string; endpoint: string; p256dh: string; auth: string }, payload: string) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await service.from("push_subscriptions").delete().eq("id", sub.id);
    } else {
      console.warn("Push send failed:", err?.message || err);
    }
  }
}

/**
 * Writes one notification row per recipient and best-effort pushes it to their
 * subscribed browsers. Never throws: a notification failure must not undo or
 * block the action that triggered it (same contract as logAudit).
 */
async function insertAndPush(service: Service, actor: ApiActor, recipientIds: string[], entry: NotifyEntry): Promise<void> {
  const ids = Array.from(new Set(recipientIds.filter(Boolean)));
  if (!ids.length) return;

  try {
    const rows = ids.map((recipient_user_id) => ({
      recipient_user_id,
      actor_user_id: actor.dbUserId ?? null,
      actor_role: actor.role,
      type: entry.type,
      title: entry.title,
      body: entry.body,
      link: entry.link ?? null,
      metadata: entry.metadata ?? {},
    }));
    const { error } = await service.from("notifications").insert(rows);
    if (error) console.warn("Notification insert failed:", error.message);
  } catch (err) {
    console.warn("Notification insert failed:", err);
  }

  if (!ensureVapid()) return;
  try {
    const { data: subs } = await service
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", ids);
    if (!subs?.length) return;
    const payload = JSON.stringify({ title: entry.title, body: entry.body, link: entry.link || "/" });
    await Promise.all(subs.map((sub: any) => pushOne(service, sub, payload)));
  } catch (err) {
    console.warn("Push lookup failed:", err);
  }
}

/** Notifies specific people by their public.users.id. Falsy ids and the actor themself are skipped. */
export async function notifyUsers(actor: ApiActor, recipientUserIds: Array<string | null | undefined>, entry: NotifyEntry): Promise<void> {
  const ids = recipientUserIds.filter((id): id is string => Boolean(id) && id !== actor.dbUserId);
  await insertAndPush(actor.service, actor, ids, entry);
}

/** Notifies every user with the given role (minus the actor, if they share it). */
export async function notifyRole(actor: ApiActor, role: "admin" | "teacher" | "student", entry: NotifyEntry): Promise<void> {
  try {
    const { data, error } = await actor.service.from("users").select("id").eq("role", role);
    if (error) {
      console.warn("notifyRole lookup failed:", error.message);
      return;
    }
    const ids = (data || []).map((u: any) => u.id as string).filter((id) => id !== actor.dbUserId);
    await insertAndPush(actor.service, actor, ids, entry);
  } catch (err) {
    console.warn("notifyRole failed:", err);
  }
}

export const notifyAdmins = (actor: ApiActor, entry: NotifyEntry) => notifyRole(actor, "admin", entry);
