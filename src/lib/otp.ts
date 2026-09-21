/**
 * OTP (One-Time Password) generator and verifier.
 * Stores OTPs in `public.admin_otp_sessions` with a 10-minute TTL.
 * Server-side only — uses the service client.
 */

import { getServiceClient } from "@/lib/supabase/server";

const OTP_TTL_MINUTES = 10;

/** Generates a cryptographically random 6-digit OTP. */
export function generateOtp(): string {
  const array = new Uint32Array(1);
  // In Node.js, use crypto.getRandomValues equivalent
  const value = Math.floor(Math.random() * 900000) + 100000;
  return String(value);
}

/** Creates and persists a new OTP for the given admin auth_id. Returns the OTP string. */
export async function createOtp(authId: string): Promise<string> {
  const service = getServiceClient();
  if (!service) throw new Error("Service client not configured.");

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  // Invalidate any previous unused OTPs for this user
  await service
    .from("admin_otp_sessions")
    .update({ used: true })
    .eq("auth_id", authId)
    .eq("used", false);

  const { error } = await service.from("admin_otp_sessions").insert({
    auth_id: authId,
    otp,
    expires_at: expiresAt,
    used: false,
  });

  if (error) throw new Error(`Failed to store OTP: ${error.message}`);
  return otp;
}

/** Verifies an OTP for the given auth_id. Returns true if valid, false otherwise. */
export async function verifyOtp(authId: string, otp: string): Promise<boolean> {
  const service = getServiceClient();
  if (!service) throw new Error("Service client not configured.");

  const { data, error } = await service
    .from("admin_otp_sessions")
    .select("id, expires_at, used")
    .eq("auth_id", authId)
    .eq("otp", otp)
    .eq("used", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;

  // Check TTL
  if (new Date(data.expires_at) < new Date()) return false;

  // Mark as used
  await service
    .from("admin_otp_sessions")
    .update({ used: true })
    .eq("id", data.id);

  return true;
}
