"use client";

import React from "react";
import AuthGuard from "@/components/shared/AuthGuard";
import PortalLayout, { NavItem } from "@/components/shared/PortalLayout";
import { useAnnouncementBadge, badgeText } from "@/components/announcements/useAnnouncementBadge";
import { usePendingApprovalsBadge } from "@/components/admin/usePendingApprovalsBadge";

const adminNavItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/admin/dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
        />
      </svg>
    ),
  },
  {
    category: "Academics & Staff",
    label: "Manage Teachers",
    href: "/admin/teachers",
  },
  {
    category: "Academics & Staff",
    label: "Manage Subjects",
    href: "/admin/subjects",
  },
  {
    category: "Academics & Staff",
    label: "Class Subject Lists",
    href: "/admin/subjects/lists",
  },
  {
    category: "Academics & Staff",
    label: "Result Approvals",
    href: "/admin/approvals",
  },
  {
    category: "Academics & Staff",
    label: "Student Remarks",
    href: "/admin/remarks",
  },
  {
    category: "Academics & Staff",
    label: "Class Promotions",
    href: "/admin/promotions",
  },
  {
    category: "Academics & Staff",
    label: "Student Results & Broadsheets",
    href: "/admin/historical-results",
  },
  {
    category: "Academics & Staff",
    label: "Leaderboard",
    href: "/admin/leaderboard",
  },
  {
    category: "Academics & Staff",
    label: "Badges",
    href: "/admin/badges",
  },
  {
    category: "Academics & Staff",
    label: "Timetable",
    href: "/admin/timetable",
  },
  {
    category: "Academics & Staff",
    label: "Announcements",
    href: "/admin/announcements",
  },
  {
    category: "Academics & Staff",
    label: "Bulk Report Cards",
    href: "/admin/report-cards",
  },
  {
    category: "Students & Portal",
    label: "Manage Students",
    href: "/admin/students",
  },
  {
    category: "Students & Portal",
    label: "Payment Status",
    href: "/admin/students/payment-status",
  },
  {
    category: "Students & Portal",
    label: "Portal Access Control",
    href: "/admin/students/access",
  },
  {
    category: "Finance & Fees",
    label: "Fee Structure",
    href: "/admin/finance/fees",
  },
  {
    category: "Finance & Fees",
    label: "School Fee Payments",
    href: "/admin/finance/payments",
  },
  {
    category: "Finance & Fees",
    label: "Financial Reports",
    href: "/admin/finance/reports",
  },
  {
    category: "Admissions & CBT",
    label: "Form Builder & QR Codes",
    href: "/admin/forms",
  },
  {
    category: "Admissions & CBT",
    label: "CBT Exam Manager",
    href: "/admin/exams",
  },
  {
    category: "Admissions & CBT",
    label: "Applicants",
    href: "/admin/admissions/applicants",
  },
  {
    category: "Settings",
    label: "Portal Access Policy",
    href: "/admin/settings/portal-access",
  },
  {
    category: "Settings",
    label: "Database Backup & Recovery",
    href: "/admin/backup",
  },
  {
    category: "Settings",
    label: "Audit Log",
    href: "/admin/audit-log",
  },
  {
    category: "Settings",
    label: "Change Password",
    href: "/admin/settings/change-password",
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const unread = useAnnouncementBadge();
  const pendingApprovals = usePendingApprovalsBadge();
  const navItems = adminNavItems.map((i) => {
    if (i.href === "/admin/announcements") return { ...i, badge: badgeText(unread) };
    if (i.href === "/admin/approvals") return { ...i, badge: badgeText(pendingApprovals) };
    return i;
  });
  return (
    <AuthGuard requiredRole="admin">
      <PortalLayout role="admin" navItems={navItems}>
        {children}
      </PortalLayout>
    </AuthGuard>
  );
}
