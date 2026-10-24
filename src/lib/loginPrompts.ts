const KEY = "gm_login_prompts_pending";

/** Call right after a successful sign-in, before landing on the dashboard. */
export function markLoginPromptsPending() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* sessionStorage may be unavailable (private mode, etc.) — the prompt just won't show */
  }
}

/** Reads and clears the flag; true only on the page load right after login. */
export function consumeLoginPromptsPending(): boolean {
  try {
    if (sessionStorage.getItem(KEY) === "1") {
      sessionStorage.removeItem(KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
