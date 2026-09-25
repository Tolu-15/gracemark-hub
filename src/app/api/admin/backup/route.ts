import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { service } = authorization.actor;

  try {
    const timestamp = new Date().toISOString();
    const dateSlug = timestamp.replace(/[:.]/g, "-").slice(0, 19);

    const tablesToExport = [
      "schools",
      "academic_sessions",
      "classes",
      "sections",
      "subjects",
      "students",
      "student_enrollments",
      "student_subject_enrollments",
      "results",
      "published_snapshots",
      "student_evaluations",
      "users",
      "class_teacher_assignments",
      "subject_teacher_assignments",
      "fee_structures",
      "fee_payments",
      "fee_receipts",
      "attendance",
      "attendance_records",
      "school_settings",
      "promotions",
    ];

    const backupData: Record<string, any[]> = {};
    const tableCounts: Record<string, number> = {};

    for (const tbl of tablesToExport) {
      try {
        let query = service.from(tbl).select("*");
        // Sanitize sensitive auth fields if users table
        if (tbl === "users") {
          query = service.from(tbl).select("id, auth_id, email, display_name, role, status, staff_id, personal_email, phone, created_at");
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          backupData[tbl] = data;
          tableCounts[tbl] = data.length;
        } else {
          backupData[tbl] = [];
          tableCounts[tbl] = 0;
        }
      } catch {
        backupData[tbl] = [];
        tableCounts[tbl] = 0;
      }
    }

    const payload = {
      manifest: {
        application: "Gracemark Academy Portal",
        system: "Disaster Recovery Database Backup",
        version: "2.0",
        timestamp,
        environment: process.env.NODE_ENV || "production",
        tableCounts,
        totalRecords: Object.values(tableCounts).reduce((a, b) => a + b, 0),
      },
      database: backupData,
    };

    const jsonString = JSON.stringify(payload, null, 2);

    return new NextResponse(jsonString, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="gracemark_disaster_recovery_backup_${dateSlug}.json"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err: any) {
    console.error("Backup export error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
