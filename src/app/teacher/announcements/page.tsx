"use client";

import AuthGuard from "@/components/shared/AuthGuard";
import AnnouncementsBoard from "@/components/announcements/AnnouncementsBoard";

export default function TeacherAnnouncementsPage() {
  return (
    <AuthGuard allowedRoles={["teacher"]}>
      <AnnouncementsBoard role="teacher" />
    </AuthGuard>
  );
}
