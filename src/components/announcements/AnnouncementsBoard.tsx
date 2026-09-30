"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";
import { getAcademicSessions } from "@/lib/academicSessions";
import { getAppSettings } from "@/lib/appSettings";
import { Skeleton } from "@/components/shared/Skeleton";

type Role = "admin" | "teacher" | "student";

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: "everyone" | "students" | "teachers";
  class_id: string | null;
  classes?: { name: string } | null;
  term_code: string;
  pinned: boolean;
  expires_at: string | null;
  expired: boolean;
  unread: boolean;
  author_user_id: string | null;
  mine: boolean;
  author_name: string | null;
  author_role: string | null;
  created_at: string;
}

const TERM_LABEL: Record<string, string> = { term1: "1st Term", term2: "2nd Term", term3: "3rd Term" };
const AUDIENCE_LABEL: Record<string, string> = { everyone: "Everyone", students: "Students", teachers: "Teachers" };

function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function AnnouncementsBoard({ role }: { role: Role }) {
  const canPost = role !== "student";
  const [session, setSession] = useState("");
  const [currentSession, setCurrentSession] = useState("");
  const [sessions, setSessions] = useState<string[]>([]);
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<Announcement[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // composer
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [audience, setAudience] = useState("everyone");
  const [classId, setClassId] = useState("");
  const [pinned, setPinned] = useState(false);
  const [expires, setExpires] = useState("");
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState("");
  const markedRef = useRef<Set<string>>(new Set());
  // Tags each load() call so a slower, older request (previous session/term filter)
  // can't resolve after a newer one and overwrite the screen with stale data.
  const loadSeqRef = useRef(0);

  useEffect(() => {
    (async () => {
      const [list, settings] = await Promise.all([getAcademicSessions(), getAppSettings()]);
      setSessions(list.map((s) => s.name));
      const cur = settings?.current_session || list[0]?.name || "";
      setCurrentSession(cur);
      setSession(cur);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ session });
      if (term) params.set("term", term);
      const res = await fetch(`/api/announcements?${params.toString()}`, { headers: await getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load announcements.");
      if (loadSeqRef.current !== seq) return; // a newer session/term selection already took over
      setItems(json.announcements);
      setClasses(json.postableClasses || []);
    } catch (e: any) {
      if (loadSeqRef.current === seq) setError(e.message);
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [session, term]);

  useEffect(() => {
    load();
  }, [load]);

  // Opening the board clears the unread badge (only for the current session).
  useEffect(() => {
    if (loading || session !== currentSession) return;
    const unread = items.filter((i) => i.unread && !markedRef.current.has(i.id)).map((i) => i.id);
    if (!unread.length) return;
    const t = setTimeout(async () => {
      unread.forEach((id) => markedRef.current.add(id));
      try {
        await fetch("/api/announcements/read", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
          body: JSON.stringify({ ids: unread }),
        });
      } catch {
        /* retried next visit */
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [items, loading, session, currentSession]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (role === "teacher" && !classId) {
      setFormError("Choose one of your classes.");
      return;
    }
    setPosting(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({
          title,
          body: text,
          audience,
          class_id: classId || null,
          pinned,
          expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not post.");
      setTitle("");
      setText("");
      setAudience("everyone");
      setClassId("");
      setPinned(false);
      setExpires("");
      setComposing(false);
      setSession(currentSession);
      await load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setPosting(false);
    }
  }

  async function togglePin(a: Announcement) {
    await fetch(`/api/announcements/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
      body: JSON.stringify({ pinned: !a.pinned }),
    });
    load();
  }

  async function remove(a: Announcement) {
    if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/announcements/${a.id}`, { method: "DELETE", headers: await getAuthHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      alert(json.error || "Could not delete.");
      return;
    }
    load();
  }

  const isArchive = session !== currentSession;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Announcements</h1>
          <p className="text-sm text-slate-500 mt-1">
            {role === "student" ? "Notices for you and your class." : role === "teacher" ? "Notices from the school, and updates to your classes." : "School-wide and class notices."}
          </p>
        </div>
        {canPost && (
          <button
            type="button"
            onClick={() => setComposing((v) => !v)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold cursor-pointer"
          >
            {composing ? "Close" : "New announcement"}
          </button>
        )}
      </header>

      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto w-full space-y-5">
        {composing && canPost && (
          <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-600">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
                required
                placeholder="e.g. Inter-house sports on Friday"
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600">Message</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={5000}
                required
                rows={5}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <div className="text-[11px] text-slate-400 text-right">{text.length}/5000</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {role === "admin" && (
                <div>
                  <label className="text-xs font-bold text-slate-600">Who sees it</label>
                  <select value={audience} onChange={(e) => setAudience(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                    <option value="everyone">Everyone</option>
                    <option value="students">Students only</option>
                    <option value="teachers">Teachers only</option>
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-slate-600">{role === "teacher" ? "Class" : "Limit to one class (optional)"}</label>
                <select
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  required={role === "teacher"}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="">{role === "teacher" ? "Select a class…" : "Whole school"}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600">Hide after (optional)</label>
                <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
            </div>
            {role === "admin" && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                Pin to the top
              </label>
            )}
            <p className="text-[11px] text-slate-400">
              This will be posted to the current session and term ({currentSession || "—"}).
            </p>
            {formError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</div>}
            <div className="flex justify-end">
              <button type="submit" disabled={posting} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold disabled:opacity-60 cursor-pointer">
                {posting ? "Posting…" : "Post announcement"}
              </button>
            </div>
          </form>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Session
            <select value={session} onChange={(e) => setSession(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal">
              {sessions.map((s) => (
                <option key={s} value={s}>
                  {s}
                  {s === currentSession ? " (current)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Term
            <select value={term} onChange={(e) => setTerm(e.target.value)} className="mt-1 block px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold normal-case tracking-normal">
              <option value="">All terms</option>
              <option value="term1">1st Term</option>
              <option value="term2">2nd Term</option>
              <option value="term3">3rd Term</option>
            </select>
          </label>
          {isArchive && <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Viewing an earlier session</span>}
        </div>

        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

        {loading ? (
          <div className="space-y-3" role="status" aria-label="Loading announcements">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <Skeleton block className="h-5 w-2/3" />
                <Skeleton block className="h-3 w-full" />
                <Skeleton block className="h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-12 text-center text-sm text-slate-500">
            No announcements {isArchive ? "in this session" : "yet"}.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((a) => {
              const canManage = role === "admin" || (role === "teacher" && a.mine);
              return (
                <article
                  key={a.id}
                  className={`gm-reveal bg-white rounded-xl border p-5 shadow-sm ${a.pinned ? "border-amber-300" : "border-slate-200"} ${a.expired ? "opacity-60" : ""}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {a.unread && <span className="h-2 w-2 rounded-full bg-indigo-600" aria-label="New" />}
                        {a.pinned && <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Pinned</span>}
                        <h2 className="text-base font-bold text-slate-900 break-words">{a.title}</h2>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-600">{a.author_name || "Staff"}</span>
                        <span>·</span>
                        <span>{timeAgo(a.created_at)}</span>
                        <span>·</span>
                        <span>{TERM_LABEL[a.term_code] || a.term_code}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">
                          {a.classes?.name ? `Class: ${a.classes.name}` : AUDIENCE_LABEL[a.audience]}
                        </span>
                        {a.expired && <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-600">Expired</span>}
                        {a.expires_at && !a.expired && <span>Hides {new Date(a.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2 shrink-0">
                        {role === "admin" && (
                          <button type="button" onClick={() => togglePin(a)} className="text-xs font-bold text-slate-600 hover:text-indigo-700 cursor-pointer">
                            {a.pinned ? "Unpin" : "Pin"}
                          </button>
                        )}
                        <button type="button" onClick={() => remove(a)} className="text-xs font-bold text-rose-600 hover:text-rose-800 cursor-pointer">
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{a.body}</p>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
