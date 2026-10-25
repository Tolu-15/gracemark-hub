import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured, sendCustomEmail } from "@/lib/email";
import { notifyAdminsFromSystem } from "@/lib/notify";

/**
 * Tells the admins a new paid application has arrived: a notification (bell and push) and, if email is
 * configured, an email to each admin. Best-effort and never throws, because it runs inside the payment
 * confirmation and must not undo or block it.
 */
export async function announceNewApplication(service: SupabaseClient, admissionId: string): Promise<void> {
  try {
    const { data: a } = await service
      .from("admissions")
      .select("application_number, surname, first_names, parent_name, parent_phone, classes:desired_class_id(name)")
      .eq("id", admissionId)
      .maybeSingle();
    if (!a) return;

    const cls = Array.isArray((a as any).classes) ? (a as any).classes[0]?.name : (a as any).classes?.name;
    const applicant = `${a.surname} ${a.first_names}`.trim();
    const where = cls ? ` for ${cls}` : "";

    await notifyAdminsFromSystem(service, {
      type: "admissions.new",
      title: "New admission application",
      body: `${applicant} applied${where} (${a.application_number}). The application fee is paid.`,
      link: "/admin/admissions/applicants",
      metadata: { admissionId, applicationNumber: a.application_number },
    });

    if (!isEmailConfigured()) return;
    const { data: admins } = await service.from("users").select("email, display_name").eq("role", "admin");
    const message =
      `A new admission application has been paid for and is waiting for review.\n\n` +
      `Applicant: ${applicant}\nClass applied for: ${cls || "not stated"}\nApplication number: ${a.application_number}\n` +
      `Parent: ${a.parent_name || "not stated"}${a.parent_phone ? ` (${a.parent_phone})` : ""}\n\n` +
      `Open Admin → Applicants to review it.`;
    await Promise.allSettled(
      (admins || [])
        .filter((u: any) => u.email && !String(u.email).endsWith("@student.gracemark.edu.ng"))
        .map((u: any) => sendCustomEmail({ toEmail: u.email, toName: u.display_name || undefined, subject: `New admission application: ${applicant}`, message }))
    );
  } catch (err) {
    console.warn("announceNewApplication failed:", err);
  }
}
