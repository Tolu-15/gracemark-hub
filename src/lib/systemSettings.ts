import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Developer-managed settings stored in public.system_settings (see supabase/041). Reads are cached
 * for a few seconds per server instance so hot paths (every API call checks maintenance mode) stay
 * cheap, and a missing table or failed read falls back to safe defaults: a settings outage must
 * never lock people out or change prices.
 */

export interface CardSettings {
  /** Naira, charged for one card. Applies to new purchases only; each purchase keeps its own price. */
  price: number;
  /** Views a new card gives. Existing cards keep the number they were issued with. */
  viewsAllowed: number;
  /** Online (Paystack) card sales. Follows SCRATCH_CARD_ONLINE_ENABLED until a developer sets it. */
  onlineEnabled: boolean;
}

export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
  /** ISO time the developer expects the app back (shown to users), or null. */
  backAt: string | null;
  /** Let every admin in, not just the developer. */
  allowAdmins: boolean;
}

export const CARD_DEFAULTS = { price: 1000, viewsAllowed: 5 } as const;
export const MAINTENANCE_DEFAULTS: MaintenanceSettings = { enabled: false, message: "", backAt: null, allowAdmins: false };

const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function readRaw(service: SupabaseClient, key: string): Promise<Record<string, any> | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Record<string, any> | null;
  let value: Record<string, any> | null = null;
  try {
    const { data, error } = await service.from("system_settings").select("value").eq("key", key).maybeSingle();
    if (!error && data?.value && typeof data.value === "object") value = data.value as Record<string, any>;
  } catch {
    /* table missing or unreachable: use defaults */
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

const validPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 50 && v <= 1_000_000;
const validViews = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 50;

export async function getCardSettings(service: SupabaseClient): Promise<CardSettings> {
  const raw = await readRaw(service, "scratch_card");
  return {
    price: validPrice(raw?.price) ? raw!.price : CARD_DEFAULTS.price,
    viewsAllowed: validViews(raw?.viewsAllowed) ? raw!.viewsAllowed : CARD_DEFAULTS.viewsAllowed,
    onlineEnabled: typeof raw?.onlineEnabled === "boolean" ? raw.onlineEnabled : process.env.SCRATCH_CARD_ONLINE_ENABLED === "true",
  };
}

export async function getMaintenance(service: SupabaseClient): Promise<MaintenanceSettings> {
  const raw = await readRaw(service, "maintenance");
  if (!raw) return MAINTENANCE_DEFAULTS;
  return {
    enabled: raw.enabled === true,
    message: typeof raw.message === "string" ? raw.message.slice(0, 500) : "",
    backAt: typeof raw.backAt === "string" && !Number.isNaN(Date.parse(raw.backAt)) ? raw.backAt : null,
    allowAdmins: raw.allowAdmins === true,
  };
}

/** Validates a developer's card settings input. Returns the clean value or an error message. */
export function parseCardSettings(input: any): { value: Record<string, unknown> } | { error: string } {
  if (!validPrice(input?.price)) return { error: "Price must be a number between ₦50 and ₦1,000,000." };
  if (!validViews(input?.viewsAllowed)) return { error: "Views per card must be a whole number from 1 to 50." };
  const value: Record<string, unknown> = { price: Math.round(input.price), viewsAllowed: input.viewsAllowed };
  if (typeof input?.onlineEnabled === "boolean") value.onlineEnabled = input.onlineEnabled;
  return { value };
}

export function parseMaintenance(input: any): { value: Record<string, unknown> } | { error: string } {
  const backAt = input?.backAt ? String(input.backAt) : null;
  if (backAt && Number.isNaN(Date.parse(backAt))) return { error: "The expected-back time is not a valid date." };
  return {
    value: {
      enabled: input?.enabled === true,
      message: String(input?.message || "").trim().slice(0, 500),
      backAt: backAt ? new Date(backAt).toISOString() : null,
      allowAdmins: input?.allowAdmins === true,
    },
  };
}

export async function saveSetting(service: SupabaseClient, key: "scratch_card" | "maintenance", value: Record<string, unknown>, userId?: string | null) {
  const { error } = await service
    .from("system_settings")
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: userId ?? null }, { onConflict: "key" });
  cache.delete(key);
  return error ? error.message : null;
}
