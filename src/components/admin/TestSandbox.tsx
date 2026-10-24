"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/supabase/client";

interface TestClass {
  id: string;
  name: string;
  subjectGroup: string | null;
  students: { id: string; name: string; admissionNo: string }[];
  results: number;
  snapshots: number;
  cards: number;
}

const TERMS = [
  { value: "term1", label: "1st Term" },
  { value: "term2", label: "2nd Term" },
  { value: "term3", label: "3rd Term" },
];

async function call(method: "GET" | "POST", body?: unknown) {
  const res = await fetch("/api/admin/dev-tools/test-class", {
    method,
    headers: { ...(await getAuthHeaders()), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || "Request failed.");
  return json;
}

/**
 * Developer-only: make a throwaway class so publishing and scratch cards can be tested on one
 * test student without touching, notifying or ranking against real classes. Only classes named
 * "ZZ Test…" can be changed from here.
 */
export default function TestSandbox() {
  const [classes, setClasses] = useState<TestClass[]>([]);
  const [groups, setGroups] = useState<{ code: string; name: string }[]>([]);
  const [prefix, setPrefix] = useState("ZZ Test");
  const [name, setName] = useState("ZZ Test Class");
  const [group, setGroup] = useState("JSS");
  const [term, setTerm] = useState("term1");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const json = await call("GET");
      setClasses(json.classes || []);
      setGroups(json.groups || []);
      if (json.prefix) setPrefix(json.prefix);
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(label: string, body: Record<string, unknown>, confirmText: string | null, done: (json: any) => string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label);
    setMessage(null);
    try {
      const json = await call("POST", body);
      setMessage({ kind: "ok", text: done(json) });
      await load();
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Test Sandbox</h2>
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-4">
        <p className="text-xs text-slate-500">
          Test publishing and scratch cards on a throwaway class, so real classes are never published, notified or ranked. Put a test student in it with{" "}
          <strong>Students → Edit → Class</strong>, fill sample scores here, then publish that class from <strong>Approvals</strong>. Only classes named &ldquo;{prefix}…&rdquo; can be changed from this
          panel.
        </p>

        {message && (
          <div className={`p-3 rounded-xl border text-xs font-semibold ${message.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
            {message.text}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Class name
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-48 px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800" />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Subject list
            <select value={group} onChange={(e) => setGroup(e.target.value)} className="mt-1 block px-3 py-2 border border-slate-300 rounded-lg text-sm normal-case tracking-normal text-slate-800">
              {(groups.length ? groups : [{ code: "JSS", name: "JSS" }]).map((g) => (
                <option key={g.code} value={g.code}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run("create", { action: "create", name, subject_group_code: group }, null, (j) => `Created "${j.class.name}". Now move a test student into it.`)}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-50"
          >
            {busy === "create" ? "Creating…" : "Create test class"}
          </button>
        </div>

        {classes.length === 0 ? (
          <p className="text-xs text-slate-400">No test classes yet.</p>
        ) : (
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 inline-block">
              Term to fill
              <select value={term} onChange={(e) => setTerm(e.target.value)} className="ml-2 px-3 py-1.5 border border-slate-300 rounded-lg text-xs normal-case tracking-normal text-slate-800">
                {TERMS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {classes.map((c) => (
              <div key={c.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{c.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {c.students.length} student{c.students.length === 1 ? "" : "s"}
                      {c.students.length ? ` (${c.students.map((s) => `${s.name} · ${s.admissionNo}`).join(", ")})` : ""} · {c.results} score{c.results === 1 ? "" : "s"} · {c.snapshots} published report
                      {c.snapshots === 1 ? "" : "s"} · {c.cards} scratch card{c.cards === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!!busy || c.students.length === 0}
                      onClick={() =>
                        run(
                          `fill:${c.id}`,
                          { action: "fill", class_id: c.id, term },
                          null,
                          (j) => `Added ${j.rowsAdded} approved sample score(s) for ${j.students} student(s) across ${j.subjects} subjects, plus attendance and remarks.`
                        )
                      }
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
                    >
                      {busy === `fill:${c.id}` ? "Filling…" : "Fill sample scores"}
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() =>
                        run(
                          `clear:${c.id}`,
                          { action: "clear", class_id: c.id },
                          `Delete ALL scores, published reports, scratch cards and remarks for the students in "${c.name}"? This cannot be undone.`,
                          (j) => `Cleared ${j.results} score(s), ${j.snapshots} report(s) and ${j.cards} card(s).`
                        )
                      }
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
                    >
                      {busy === `clear:${c.id}` ? "Clearing…" : "Clear test data"}
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => run(`delete:${c.id}`, { action: "delete", class_id: c.id }, `Delete the empty class "${c.name}"?`, () => `Deleted "${c.name}".`)}
                      className="px-3 py-1.5 border border-slate-300 text-slate-700 font-bold rounded-lg text-xs cursor-pointer disabled:opacity-40"
                    >
                      Delete class
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-slate-400">
              To finish: Clear test data, move the student back to their real class (Students → Edit → Class), then Delete class.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
