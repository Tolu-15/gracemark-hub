"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { resolveStudentUserIdCandidates } from "@/lib/auth";
import { getStudentCurrentInvoice, formatCurrency } from "@/lib/schoolFinance";

export default function StudentLockedPage() {
  const router = useRouter();
  const [student, setStudent] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [lockReason, setLockReason] = useState("Outstanding school fee balance");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.push("/");
          return;
        }

        const candidateIds = await resolveStudentUserIdCandidates(user.id);
        const { data: std } = await supabase
          .from("students")
          .select("id, name, admission_no, portal_access_status, portal_lock_reason")
          .in("user_id", candidateIds)
          .maybeSingle();

        if (std) {
          setStudent(std);
          if (std.portal_lock_reason) {
            setLockReason(std.portal_lock_reason);
          }

          const fin = await getStudentCurrentInvoice(std.id);
          if (fin) {
            setBalance(fin.outstandingBalance);
            // If already fully paid and unlocked
            if (fin.outstandingBalance <= 0 && std.portal_access_status !== "LOCKED") {
              router.push("/student/dashboard");
              return;
            }
          }
        }
      } catch (err) {
        console.error("Lock check error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-950 z-50 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-sm font-medium text-slate-400">Verifying Portal Access...</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 text-slate-100 flex items-center justify-center min-h-screen p-4">
      <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-3xl p-8 shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-center mx-auto text-3xl font-bold">
          Access locked
        </div>

        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">PORTAL ACCESS RESTRICTED</h1>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Your student portal access has been temporarily restricted due to an outstanding school fee balance or administrative lock policy.
          </p>
        </div>

        <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-700/60 space-y-3 text-left">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400 font-semibold">Student Name:</span>
            <span className="font-bold text-white">{student?.name || "Student"}</span>
          </div>
          <div className="flex justify-between items-center text-xs border-t border-slate-800 pt-2">
            <span className="text-slate-400 font-semibold">Outstanding Balance:</span>
            <span className="font-extrabold text-rose-400 text-sm">{formatCurrency(balance)}</span>
          </div>
          <div className="text-xs border-t border-slate-800 pt-2">
            <span className="text-slate-400 font-semibold block mb-1">Lock Reason:</span>
            <span className="text-slate-300 italic text-[11px] block">{lockReason}</span>
          </div>
        </div>

        <div className="space-y-3">
          <Link
            href="/student/school-fees"
            className="block w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-bold text-xs rounded-xl transition-colors shadow-lg"
          >
            View Fees &amp; Make Payment →
          </Link>
          <div className="grid grid-cols-2 gap-2">
            <Link
              href="/student/payment-history"
              className="py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-xs rounded-xl transition-colors text-center"
            >
              Payment History
            </Link>
            <Link
              href="/student/receipts"
              className="py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-xs rounded-xl transition-colors text-center"
            >
              View Receipts
            </Link>
          </div>
        </div>

        <p className="text-[11px] text-slate-500">
          If you believe this is an error, please contact the school administrator.
        </p>
      </div>
    </div>
  );
}
