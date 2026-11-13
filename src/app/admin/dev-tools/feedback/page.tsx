"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import { getAuthHeaders } from "@/lib/supabase/client";

type FeedbackItem = {
  id: string;
  name: string | null;
  email: string | null;
  feedback_type: "suggestion" | "technical_issue" | "general_feedback";
  message: string;
  source_page: string;
  status: "new" | "in_progress" | "resolved";
  created_at: string;
};

const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function DeveloperFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/dev-tools/feedback", { headers: await getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load feedback.");
      setItems(data.feedback || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load feedback.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: FeedbackItem["status"]) {
    setUpdating(id);
    try {
      const response = await fetch("/api/admin/dev-tools/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ id, status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update feedback.");
      setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update feedback.");
    } finally {
      setUpdating(null);
    }
  }

  return (
    <AuthGuard requiredRole="admin">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-5">
          <div><h1 className="text-2xl font-bold text-neutral-950">Feedback Inbox</h1><p className="mt-1 text-sm text-neutral-600">Public feedback received by the developer account.</p></div>
          <button onClick={load} className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800">Refresh</button>
        </header>
        {error && <p role="alert" className="rounded-lg border border-neutral-300 bg-white p-3 text-sm text-neutral-800">{error}</p>}
        {loading ? <p className="py-12 text-center text-sm text-neutral-500">Loading feedback...</p> : items.length === 0 ? <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">No feedback has been received yet.</div> : (
          <div className="space-y-4">
            {items.map((item) => <article key={item.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="font-bold text-neutral-950">{label(item.feedback_type)}</h2><p className="mt-1 text-xs text-neutral-500">{new Date(item.created_at).toLocaleString("en-NG")} · {item.source_page}</p></div>
                <select value={item.status} disabled={updating === item.id} onChange={(event) => updateStatus(item.id, event.target.value as FeedbackItem["status"])} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 disabled:opacity-50"><option value="new">New</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-neutral-800">{item.message}</p>
              <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">{item.name || "Anonymous"}{item.email ? ` · ${item.email}` : ""}</p>
            </article>)}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
