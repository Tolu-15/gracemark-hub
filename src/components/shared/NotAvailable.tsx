import React from "react";
import Link from "next/link";

export default function NotAvailable({
  title = "Not available",
  message = "This feature is not available at the moment.",
  backHref = "/student/dashboard",
  backLabel = "Back to dashboard",
}: {
  title?: string;
  message?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-sm text-center bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xl font-bold">
          !
        </div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500 mt-1">{message}</p>
        <Link
          href={backHref}
          className="inline-block mt-5 px-5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 transition"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}
