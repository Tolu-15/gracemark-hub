import { levelGroupName, StudentReport } from "@/lib/reportBuilder";

type Service = any;

/**
 * Awards (or revokes) position-based badges for a set of published reports.
 * Called once per class publish, right after applyLevelWidePositions has set
 * the level-wide position on each report. Top 3 gets a badge; anyone whose
 * corrected position falls outside the top 3 on a republish has their badge
 * removed, so badges never lag behind the actual (possibly corrected) result.
 */
export async function awardPositionBadges(service: Service, reports: StudentReport[], term: string, session: string): Promise<void> {
  if (!reports.length) return;

  const levelName = levelGroupName(reports[0].className);

  const toAward = reports.filter((r) => r.summary.position !== null && r.summary.position <= 3);
  const toClear = reports.filter((r) => r.summary.position === null || r.summary.position > 3);

  if (toAward.length) {
    const rows = toAward.map((r) => ({
      student_id: r.student.id,
      badge_type: `position_${r.summary.position}` as const,
      level_name: levelName,
      class_name: r.className,
      position: r.summary.position as number,
      ranked_count: r.summary.rankedCount,
      term,
      session,
    }));
    const { error } = await service.from("student_badges").upsert(rows, { onConflict: "student_id,term,session,level_name" });
    if (error) console.warn("awardPositionBadges upsert failed:", error.message);
  }

  if (toClear.length) {
    const { error } = await service
      .from("student_badges")
      .delete()
      .eq("term", term)
      .eq("session", session)
      .eq("level_name", levelName)
      .in("student_id", toClear.map((r) => r.student.id));
    if (error) console.warn("awardPositionBadges cleanup failed:", error.message);
  }
}
