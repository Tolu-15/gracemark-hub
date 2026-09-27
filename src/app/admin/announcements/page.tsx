"use client";

import AuthGuard from "@/components/shared/AuthGuard";
import AnnouncementsBoard from "@/components/announcements/AnnouncementsBoard";

export default function AdminAnnouncementsPage() {
  return (
    <AuthGuard allowedRoles={["admin"]}>
      <AnnouncementsBoard role="admin" />
    </AuthGuard>
  );
}
