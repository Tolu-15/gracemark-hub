"use client";

import AuthGuard from "@/components/shared/AuthGuard";
import AnnouncementsBoard from "@/components/announcements/AnnouncementsBoard";

export default function StudentAnnouncementsPage() {
  return (
    <AuthGuard allowedRoles={["student"]}>
      <AnnouncementsBoard role="student" />
    </AuthGuard>
  );
}
