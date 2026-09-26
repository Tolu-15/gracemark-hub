"use client";

import React from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import PortalLayout, { NavItem } from "@/components/shared/PortalLayout";
import { PAYMENTS_ENABLED } from "@/lib/features";

const studentNavItems: NavItem[] = [
  {
    label: "Results Dashboard",
    href: "/student/dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
    ),
  },
  {
    label: "My Assessments",
    href: "/student/assessments",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
        />
      </svg>
    ),
  },
  {
    label: "Report Sheet",
    href: "/student/result",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  },
  {
    label: "Bio Profile",
    href: "/student/profile",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    ),
  },
  {
    category: "Fees & Financials",
    label: "School Fees",
    href: "/student/school-fees",
    disabled: !PAYMENTS_ENABLED,
  },
  {
    category: "Fees & Financials",
    label: "Payment History",
    href: "/student/payment-history",
    disabled: !PAYMENTS_ENABLED,
  },
  {
    category: "Fees & Financials",
    label: "Payment Receipts",
    href: "/student/receipts",
    disabled: !PAYMENTS_ENABLED,
  },
  {
    category: "Fees & Financials",
    label: "Financial Report",
    href: "/student/financial-report",
    disabled: !PAYMENTS_ENABLED,
  },
  {
    category: "Account",
    label: "Change Password",
    href: "/student/change-password",
  },
];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard requiredRole="student">
      <PortalLayout role="student" navItems={studentNavItems}>
        {children}
      </PortalLayout>
    </AuthGuard>
  );
}
