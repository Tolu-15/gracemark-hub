"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";

interface AssignmentChange {
  kind: "added" | "removed";
  role: string;
  className: string;
  subjectName?: string;
}
interface ChangeTeacher {
  teacherId: string;
  name: string;
  email: string | null;
  changes: AssignmentChange[];
}
interface PendingLogin {
  teacherId: string;
  name: string;
  staffId: string | null;
  email: string | null;
  lastSignIn: string | null;
}
type Result = { type: "success" | "error"; text: string } | null;

/** Admin actions that email teachers: assignment updates and first-sign-in login reminders. */
export default function TeacherEmailPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [changes, setChanges] = useState<ChangeTeacher[]>([]);
  const [changesError, setChangesError] = useState("");
  const [logins, setLogins] = useState<PendingLogin[]>([]);
  const [open, setOpen] = useState<"changes" | "logins" | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const load = useCallback(async () => {
    const headers = await getAuthHeaders();
    try {
      const res = await fetch("/api/admin/teachers/notify-assignments", { headers });
      const json = await res.json();
      if (json.ok) {
        setChanges(json.teachers || []);
        setChangesError("");
      } else {
        setChanges([]);
        setChangesError(json.error || "Could not load assignment changes.");
      }
    } catch {
      setChangesError("Could not load assignment changes.");
    }
    try {
      const res = await fetch("/api/admin/teachers/resend-login", { headers });
      const json = await res.json();
      if (json.ok) setLogins(json.teachers || []);
    } catch {}
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function send(kind: "changes" | "logins") {
    setBusy(true);
    setResult(null);
    try {
      const url = kind === "changes" ? "/api/admin/teachers/notify-assignments" : "/api/admin/teachers/resend-login";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Sending failed.");

      const failed: { name: string; error: string }[] = json.failed || [];
      const parts = [`${json.sent} email${json.sent === 1 ? "" : "s"} sent`];
      if (failed.length) parts.push(`${failed.length} failed (${failed.map((f) => `${f.name}: ${f.error}`).join("; ")})`);
      if (json.skipped?.length) parts.push(`${json.skipped.length} skipped, no email address (${json.skipped.join(", ")})`);
      setResult({ type: failed.length ? "error" : "success", text: parts.join(" · ") });
      await load();
    } catch (err: any) {
      setResult({ type: "error", text: err.message || "Sending failed." });
    } finally {
      setBusy(false);
    }
  }

  const describe = (c: AssignmentChange) =>
    `${c.kind === "added" ? "+" : "−"} ${c.subjectName ? `${c.subjectName} (${c.className})` : `Class Teacher, ${c.className}`}`;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wider sm:mr-auto">Email teachers</span>
        <button
          type="button"
          onClick={() => setOpen(open === "changes" ? null : "changes")}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition cursor-pointer"
        >
          Assignment updates ({changes.length})
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === "logins" ? null : "logins")}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-slate-900 hover:bg-amber-400 transition cursor-pointer"
        >
          Resend login details ({logins.length})
        </button>
      </div>

      {open === "changes" && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-3">
          {changesError ? (
            <p className="text-xs text-red-700">{changesError}</p>
          ) : changes.length === 0 ? (
            <p className="text-xs text-slate-500">No new assignment changes since the last email was sent.</p>
          ) : (
            <>
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {changes.map((t) => (
                  <li key={t.teacherId} className="text-xs">
                    <span className="font-bold text-slate-900">{t.name}</span>
                    <span className="text-slate-400"> · {t.email || "no email on file"}</span>
                    <div className="text-slate-600 pl-3">
                      {t.changes.map((c, i) => (
                        <div key={i} className={c.kind === "added" ? "text-emerald-700" : "text-red-700"}>
                          {describe(c)}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => send("changes")}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
              >
                {busy ? "Sending…" : `Send to ${changes.length} teacher${changes.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      )}

      {open === "logins" && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-3">
          {logins.length === 0 ? (
            <p className="text-xs text-slate-500">Every teacher has completed their first sign-in.</p>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                These teachers have not completed first sign-in. Sending re-issues the initial password and emails the
                original welcome message with their login details.
              </p>
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {logins.map((t) => (
                  <li key={t.teacherId} className="text-xs text-slate-700">
                    <span className="font-bold text-slate-900">{t.name}</span>
                    {t.staffId ? <span className="text-slate-400"> · {t.staffId}</span> : null}
                    <span className="text-slate-400"> · {t.email || "no email"}</span>
                    <span className="text-slate-400">
                      {" "}
                      · {t.lastSignIn ? "signed in, password not changed" : "never signed in"}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => send("logins")}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-slate-900 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
              >
                {busy ? "Sending…" : `Send login details to ${logins.length} teacher${logins.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      )}

      {result && (
        <p className={`text-xs font-medium ${result.type === "success" ? "text-emerald-700" : "text-red-700"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
