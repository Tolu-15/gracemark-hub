import { supabase } from "/js/shared/supabaseClient.js";
import { createSecondarySupabaseClient } from "/js/shared/secondaryClient.js";

function getSignUpUser(signUpResult) {
  return signUpResult?.data?.user ?? signUpResult?.user ?? null;
}

function describeSignUpFailure(signUpResult, { accountLabel = "account" } = {}) {
  const user = getSignUpUser(signUpResult);
  if (user && Array.isArray(user.identities) && user.identities.length === 0) {
    return `This ${accountLabel} is already registered in Supabase Auth.`;
  }

  return (
    "Signup failed: Supabase did not return a new user id. " +
    "Set SUPABASE_SERVICE_ROLE_KEY in .env and restart the server, or enable email/password signups " +
    "and disable “Confirm email” in Supabase Auth settings."
  );
}

async function createAuthUserViaServerApi({ email, password }) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("You must be signed in as admin to create accounts.");

  const response = await fetch("/api/admin/create-auth-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || `Failed to create auth user (HTTP ${response.status}).`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  if (!payload?.user?.id) throw new Error("Server did not return a new user id.");
  return payload.user;
}

async function createAuthUserViaSecondaryClient({ email, password, storageKey, accountLabel = "account" }) {
  const secondary = createSecondarySupabaseClient(storageKey);
  try {
    const signUpResult = await secondary.auth.signUp({ email, password });
    if (signUpResult.error) throw signUpResult.error;

    const signUpUser = getSignUpUser(signUpResult);
    if (!signUpUser?.id) {
      console.warn("Secondary signup returned no user id:", signUpResult);
      throw new Error(describeSignUpFailure(signUpResult, { accountLabel: accountLabel }));
    }

    return signUpUser;
  } finally {
    await secondary.auth.signOut();
  }
}

/**
 * Creates a Supabase Auth user without replacing the admin session.
 * Prefers the local server API (service role). Falls back to a secondary client signup.
 */
export async function createAuthUserAsAdmin({
  email,
  password,
  storageKey = "gracemark-secondary-signup",
  accountLabel = "account",
}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("Email and password are required.");
  }

  try {
    return await createAuthUserViaServerApi({
      email: normalizedEmail,
      password: normalizedPassword,
    });
  } catch (error) {
    const useFallback =
      error?.status === 503 ||
      error?.status === 405 ||
      error?.status === 404 ||
      /not configured/i.test(error?.message || "") ||
      /method not allowed/i.test(error?.message || "") ||
      /service role/i.test(error?.message || "");

    if (!useFallback) throw error;

    console.warn(
      "Server create-user API unavailable (use npm start + .env service key). Trying client signup:",
      error?.message
    );
  }

  return createAuthUserViaSecondaryClient({
    email: normalizedEmail,
    password: normalizedPassword,
    storageKey,
    accountLabel,
  });
}

export { describeSignUpFailure, getSignUpUser };
