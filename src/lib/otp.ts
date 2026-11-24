import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const TRUST_COOKIE = "gm_device";
export const TRUST_SECONDS = 30 * 24 * 3600;

function sign(value: string) {
  const key = process.env.ADMIN_OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Admin verification is unavailable.");
  return createHmac("sha256", key).update(value).digest("hex");
}

export const generateOtp = () => String(randomInt(100000, 1000000));
export const otpDigest = (user: string, session: string, code: string) => sign(["otp", user, session, code].join(":"));

export function issueDevice(user: string, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + TRUST_SECONDS;
  return expiry + "." + sign(["device", user, expiry].join(":"));
}

export function trustsDevice(value: string | undefined, user: string, now = Date.now()) {
  if (!value || !/^\d{10}\.[0-9a-f]{64}$/.test(value)) return false;
  const [expiry, mac] = value.split(".");
  if (Number(expiry) <= now / 1000 || Number(expiry) > now / 1000 + TRUST_SECONDS) return false;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(sign(["device", user, expiry].join(":"))));
}

// Called only after getUser(token) has authenticated this very token.
export function verifiedSessionId(token: string) {
  try {
    const id = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).session_id;
    return typeof id === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch { return null; }
}
