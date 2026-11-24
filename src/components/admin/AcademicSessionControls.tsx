"use client";

import { scheduleInitialLoad } from "@/lib/scheduleInitialLoad";
import React, { useEffect, useState } from "react";
import { supabase, getAuthHeaders } from "@/lib/supabase/client";
import { getAppSettings, setAppSettings } from "@/lib/appSettings";
import {
  getAcademicSessions,
  createAcademicSession,
  deleteAcademicSession,
  deleteAllAcademicSessions,
} from "@/lib/academicSessions";
interface TermStatus {
  term: string;
  label: string;
  is_current: boolean;
  allow_edit: boolean;
  status: string;
}

export default function AcademicSessionControls({ onChange }: { onChange: () => void }) {
  const [term, setTerm] = useState("1st Term");
  const [session, setSession] = useState("");
  const [sessionsList, setSessionsList] = useState<string[]>([]);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newSessionInput, setNewSessionInput] = useState("");
  const [termsList, setTermsList] = useState<TermStatus[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [updatingTerm, setUpdatingTerm] = useState<string | null>(null);

  function termDbToUi(t?: string) {
    if (t === "term1") return "1st Term";
    if (t === "term2") return "2nd Term";
    if (t === "term3") return "3rd Term";
    return "1st Term";
  }

  function termUiToDb(t: string) {
    if (t === "1st Term") return "term1";
    if (t === "2nd Term") return "term2";
    if (t === "3rd Term") return "term3";
    return "term1";
  }

  async function loadSessions(activeFromSettings?: string) {
    const dbSessions = await getAcademicSessions();
    const names = dbSessions.map((s) => s.name);
    setSessionsList(names);

    if (activeFromSettings && names.includes(activeFromSettings)) {
      setSession(activeFromSettings);
    } else if (names.length > 0) {
      setSession(names[0]);
    } else {
      setSession("");
    }
    return names;
  }

  async function loadData() {
    const settings = await getAppSettings();
    if (settings?.current_term) setTerm(termDbToUi(settings.current_term));
    await loadSessions(settings?.current_session);
    await loadTermPermissions(settings?.current_term, settings?.current_session);
  }

  async function loadTermPermissions(overrideTermDb?: string, overrideSessionDb?: string) {
    try {
      const appSettings = overrideTermDb ? null : await getAppSettings();
      const currentTermDb = overrideTermDb || appSettings?.current_term || termUiToDb(term);
      const currentSessionDb = overrideSessionDb || session || appSettings?.current_session || "";

      // 1. Read this session's academic_terms rows directly from Supabase
      const { data: sessRow } = await supabase
        .from("academic_sessions")
        .select("id")
        .eq("name", currentSessionDb)
        .maybeSingle();
      const { data: termsRows } = sessRow?.id
        ? await supabase
            .from("academic_terms")
            .select("term_code, allow_teacher_edit")
            .eq("academic_session_id", sessRow.id)
        : { data: [] as any[] };

      const termMap = new Map<string, any>();
      (termsRows || []).forEach((r) => termMap.set(r.term_code, r));

      const termKeys = [
        { term: "term1", label: "1st Term" },
        { term: "term2", label: "2nd Term" },
        { term: "term3", label: "3rd Term" },
      ];

      const computedTerms: TermStatus[] = termKeys.map(({ term: tKey, label }) => {
        const isCurrent = tKey === currentTermDb;
        const row = termMap.get(tKey);
        const allowEdit = isCurrent || Boolean(row?.allow_teacher_edit);
        return {
          term: tKey,
          label,
          is_current: isCurrent,
          allow_edit: allowEdit,
          status: isCurrent ? "current" : allowEdit ? "unlocked" : "locked",
        };
      });

      setTermsList(computedTerms);
    } catch (err) {
      console.error("Failed to load term permissions directly, querying API fallback:", err);
      try {
        const currentSessionDb = overrideSessionDb || session || "";
        const res = await fetch(`/api/terms?session=${encodeURIComponent(currentSessionDb)}`);
        if (res.ok) {
          const data = await res.json();
          setTermsList(data.terms || []);
        }
      } catch (apiErr) {
        console.error("API term fetch error:", apiErr);
      }
    }
  }

  useEffect(() => scheduleInitialLoad(loadData), []);

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      let targetSession = session;
      const targetTermDb = termUiToDb(term);

      if (isCreatingSession) {
        const trimmed = newSessionInput.trim();
        if (!trimmed) {
          alert("Please enter a valid session name (e.g. 2026/2027).");
          setSavingSettings(false);
          return;
        }
        await createAcademicSession(trimmed, true);
        targetSession = trimmed;
        setIsCreatingSession(false);
        setNewSessionInput("");
        await loadSessions(targetSession);
      } else {
        await setAppSettings({
          current_term: targetTermDb,
          current_session: targetSession,
        });
      }

      alert(`Global academic settings updated! Active Term is now: ${term}, Session: ${targetSession || "(None)"}`);
      await loadTermPermissions(targetTermDb, targetSession);
      onChange();
    } catch (error: any) {
      alert("Failed to save global settings: " + error.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleDeleteCurrentSession() {
    if (!session) return;
    const confirmDelete = window.confirm(
      `Are you sure you want to delete session "${session}"?\nThis will remove it from the system.`
    );
    if (!confirmDelete) return;

    setDeletingSession(true);
    try {
      await deleteAcademicSession(session);
      alert(`Session "${session}" deleted successfully.`);
      await loadSessions();
      await loadTermPermissions();
      onChange();
    } catch (err: any) {
      alert("Failed to delete session: " + err.message);
    } finally {
      setDeletingSession(false);
    }
  }

  async function handleDeleteAllSessions() {
    const confirmDelete = window.confirm(
      "WARNING: Are you sure you want to delete ALL academic sessions?\nThis will remove all created sessions from the database."
    );
    if (!confirmDelete) return;

    setDeletingSession(true);
    try {
      await deleteAllAcademicSessions();
      alert("All academic sessions have been wiped successfully.");
      await loadSessions();
      await loadTermPermissions();
      onChange();
    } catch (err: any) {
      alert("Failed to delete all sessions: " + err.message);
    } finally {
      setDeletingSession(false);
    }
  }

  async function handleToggleTerm(t: TermStatus) {
    setUpdatingTerm(t.term);
    try {
      const effectiveSession = session || (await getAppSettings())?.current_session || "";
      if (!effectiveSession) {
        alert("Please select or save an active academic session first.");
        return;
      }

      const newAllow = !t.allow_edit;

      // Persist through the server (service role), which is authoritative — the
      // browser's own client may be blocked by RLS and must not be trusted silently.
      const res = await fetch("/api/admin/terms/toggle-edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify({
          session: effectiveSession,
          term: t.term,
          allow_edit: newAllow,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        throw new Error(json.error || `Failed to update term (status ${res.status})`);
      }

      await loadTermPermissions();
      onChange();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setUpdatingTerm(null);
    }
  }

  return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Term & Session Switcher */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <h3 className="text-base font-bold text-slate-900 mb-1">Academic Session &amp; Term Settings</h3>
          <p className="text-xs text-slate-500 mb-6">
            Global controls dictate the active cycle across all teacher gradebooks and student dashboards.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                Active Academic Term
              </label>
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="1st Term">1st Term</option>
                <option value="2nd Term">2nd Term</option>
                <option value="3rd Term">3rd Term</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Active Session
                </label>
                <button
                  type="button"
                  onClick={() => setIsCreatingSession(!isCreatingSession)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  {isCreatingSession ? "Cancel" : "+ Create New"}
                </button>
              </div>

              {!isCreatingSession ? (
                sessionsList.length === 0 ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex flex-col gap-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      No academic sessions created yet.
                    </div>
                    <p className="text-slate-600">Click &apos;+ Create New&apos; above to add your first session.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={session}
                        onChange={(e) => setSession(e.target.value)}
                        className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                      >
                        {sessionsList.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleDeleteCurrentSession}
                        disabled={deletingSession || !session}
                        title={`Delete session ${session}`}
                        className="p-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl transition disabled:opacity-40"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleDeleteAllSessions}
                        disabled={deletingSession}
                        className="text-xs text-rose-500 hover:text-rose-700 underline font-medium"
                      >
                        Delete All Sessions
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <input
                  type="text"
                  value={newSessionInput}
                  onChange={(e) => setNewSessionInput(e.target.value)}
                  placeholder="e.g. 2026/2027"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              )}
            </div>

            <button
              type="button"
              disabled={savingSettings || (!isCreatingSession && !session)}
              onClick={handleSaveSettings}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition shadow-sm mt-2 disabled:opacity-50"
            >
              {savingSettings ? "Saving Settings…" : "Save Academic Settings"}
            </button>
          </div>
        </div>

        {/* Term Edit Overrides Matrix */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <h3 className="text-base font-bold text-slate-900 mb-1">Teacher Score Entry Permissions</h3>
          <p className="text-xs text-slate-500 mb-6">
            Non-current terms are locked by default. Permit temporary overrides for revisions.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {termsList.map((t) => {
              if (t.is_current) {
                return (
                  <div
                    key={t.term}
                    className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl flex flex-col justify-between gap-3 shadow-xs"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase text-blue-600 block">
                        Current Active
                      </span>
                      <span className="text-base font-bold text-blue-950">{t.label}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                      Always Open
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={t.term}
                  className={`p-4 rounded-xl flex flex-col justify-between gap-3 border shadow-xs transition-colors ${
                    t.allow_edit ? "bg-emerald-50/70 border-emerald-200" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div>
                    <span
                      className={`text-[10px] font-bold uppercase block ${
                        t.allow_edit ? "text-emerald-600" : "text-slate-400"
                      }`}
                    >
                      {t.allow_edit ? "Override Open" : "Locked (Default)"}
                    </span>
                    <span className="text-base font-bold text-slate-800">{t.label}</span>
                  </div>
                  <button
                    type="button"
                    disabled={updatingTerm === t.term}
                    onClick={() => handleToggleTerm(t)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                      t.allow_edit
                        ? "bg-rose-100 hover:bg-rose-200 text-rose-800 border-rose-300"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white border-transparent"
                    }`}
                  >
                    {updatingTerm === t.term ? "Updating…" : t.allow_edit ? "Lock Term" : "Permit Edit"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
  );
}
