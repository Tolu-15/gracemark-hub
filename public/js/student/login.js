// ============================================================
//  Gracemark Academy — Auth (Supabase)
//  Vanilla JS + supabase-js CDN
// ============================================================

import { signInWithEmail, fetchUserProfileByAuthId, destinationForRole } from "/js/shared/auth.js";
import { supabase } from "/js/shared/supabaseClient.js";

// DOM References
const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const pwdInput = document.getElementById("password");
const signInBtn = document.getElementById("signInBtn");
const btnText = document.getElementById("btnText");
const btnArrow = document.getElementById("btnArrow");
const spinner = document.getElementById("spinner");
const errorAlert = document.getElementById("errorAlert");
const errorMsg = document.getElementById("errorMsg");
const togglePwd = document.getElementById("togglePwd");
const eyeIcon = document.getElementById("eyeIcon");

if (!loginForm) {
  throw new Error("loginForm not found on page.");
}

// Password Visibility Toggle
const EYE_OPEN = `
  <path stroke-linecap="round" stroke-linejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
  <path stroke-linecap="round" stroke-linejoin="round"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7
           -1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;

const EYE_SHUT = `
  <path stroke-linecap="round" stroke-linejoin="round"
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7
           a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878
           l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59
           m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0
           01-4.132 5.411m0 0L21 21"/>`;

togglePwd?.addEventListener("click", () => {
  const isHidden = pwdInput.type === "password";
  pwdInput.type = isHidden ? "text" : "password";
  eyeIcon.innerHTML = isHidden ? EYE_SHUT : EYE_OPEN;
  togglePwd.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  togglePwd.setAttribute("aria-pressed", isHidden ? "true" : "false");
});

// UI helpers
function setLoading(loading) {
  signInBtn.disabled = loading;
  spinner.style.display = loading ? "block" : "none";
  btnArrow.style.display = loading ? "none" : "block";
  btnText.textContent = loading ? "Signing in…" : "Sign In";
}

function showError(message) {
  errorAlert.classList.remove("show");
  errorMsg.textContent = message;
  void errorAlert.offsetWidth;
  errorAlert.classList.add("show");
}

function hideError() {
  errorAlert.classList.remove("show");
}

function friendlyAuthError(error) {
  const message = String(error?.message || "");
  const code = String(error?.code || "");

  if (/email not confirmed/i.test(message)) {
    return "Email not confirmed. In Supabase go to Auth → Users, open your user, and confirm email — or disable “Confirm email” under Auth → Providers → Email.";
  }
  if (/invalid login credentials|invalid_credentials/i.test(message + code)) {
    return "Wrong email or password for THIS Supabase project. Old accounts from a previous project do not carry over — create the user again under Authentication → Users.";
  }
  if (/invalid api key|jwt/i.test(message)) {
    return "Supabase API key mismatch. Check SUPABASE_URL and anon key in supabase.js match Project Settings → API.";
  }
  if (/relation.*users.*does not exist|Could not find the table.*users/i.test(message)) {
    return "Database not set up. Run supabase/schema.sql and supabase/rls.sql in the Supabase SQL editor first.";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "Cannot reach Supabase. Use npm start and open http://127.0.0.1:5502 (not a file:// link).";
  }

  const map = {
    "auth/invalid-credentials": "Invalid email or password. Please try again.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many failed attempts. Please wait a moment and try again.",
  };
  return map[code] ?? (message || "Something went wrong. Please try again.");
}

async function clearStaleAuthSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error && /invalid|expired|jwt/i.test(error.message || "")) {
      await supabase.auth.signOut();
      return;
    }
    if (!data?.session) return;
    const { error: userError } = await supabase.auth.getUser();
    if (userError && /invalid|expired|jwt|session/i.test(userError.message || "")) {
      await supabase.auth.signOut();
    }
  } catch {
    /* ignore */
  }
}

// Auto-redirect if the user is already logged in
// supabase.auth.getUser().then(async ({ data: { user } }) => {
//   if (user) {
//     const profile = await fetchUserProfileByAuthId(user.id);
//     if (profile?.role) {
//       window.location.replace(destinationForRole(profile.role));
//     }
//   }
// });

async function resolveUserLoginEmail(rawId) {
  const trimmed = String(rawId || "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed.toLowerCase();

  const cleanRef = trimmed.replace(/^PAY-/i, "").replace(/\s+/g, "").toUpperCase();

  // 1. Check students table by admission_no
  try {
    const { data: student } = await supabase
      .from("students")
      .select("user_id, admission_no, users(email)")
      .ilike("admission_no", cleanRef)
      .limit(1)
      .maybeSingle();

    if (student?.users?.email) {
      return student.users.email;
    }
  } catch {
    /* RLS unauthenticated fallback */
  }

  // 2. Check admissions table by admission_number
  try {
    const { data: adm } = await supabase
      .from("admissions")
      .select("parent_guardian_email, admission_number")
      .ilike("admission_number", cleanRef)
      .limit(1)
      .maybeSingle();

    if (adm?.parent_guardian_email) {
      return adm.parent_guardian_email;
    }
  } catch {
    /* RLS unauthenticated fallback */
  }

  // 3. Fallback synthetic student email format
  const clean = cleanRef.replace(/\//g, "").replace(/-/g, "").toLowerCase();
  return `${clean}@student.gracemark.edu.ng`;
}

// Form submit
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();

  const rawInput = emailInput.value;
  const password = pwdInput.value;

  if (!rawInput || !password) {
    showError("Please enter both your email/admission number and password.");
    return;
  }

  setLoading(true);

  try {
    let targetEmail = await resolveUserLoginEmail(rawInput);
    let signInData = null;

    try {
      signInData = await signInWithEmail(targetEmail, password);
    } catch (firstErr) {
      if (!rawInput.includes("@")) {
        const cleanRef = rawInput.replace(/^PAY-/i, "").replace(/\s+/g, "").toUpperCase();
        const altSynthetic = `${cleanRef.replace(/[^A-Z0-9]/g, "").toLowerCase()}@student.gracemark.edu.ng`;
        if (altSynthetic !== targetEmail) {
          try {
            signInData = await signInWithEmail(altSynthetic, password);
          } catch {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      } else {
        throw firstErr;
      }
    }

    const user = signInData?.user;
    if (!user?.id) throw new Error("Sign-in succeeded but no user was returned.");

    if (signInData.session) {
      await supabase.auth.setSession(signInData.session);
    }

    const { data: sessionCheck } = await supabase.auth.getSession();
    if (!sessionCheck?.session) {
      throw new Error("Could not save login session. Clear site data for 127.0.0.1:5502 and try again.");
    }

    const profile = await fetchUserProfileByAuthId(user.id);

    console.log("Supabase Auth User ID:", user.id);
    console.log("Full user profile from DB:", profile);

    if (!profile?.role) {
      showError(
        "Signed in to Supabase Auth, but there is no row in public.users for this account. " +
          "Run supabase/setup_first_admin.sql in the SQL editor (replace the UUID with your Auth user id)."
      );
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    btnText.textContent = "Redirecting…";
    window.location.replace(destinationForRole(String(profile.role).trim()));
  } catch (error) {
    console.error("[Auth Error]", error?.code, error?.message);
    showError(friendlyAuthError(error));
    setLoading(false);
  }
});

[emailInput, pwdInput].forEach((input) => input?.addEventListener("input", hideError));

clearStaleAuthSession();
