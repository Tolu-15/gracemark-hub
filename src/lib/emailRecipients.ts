import type { SupabaseClient } from "@supabase/supabase-js";

export interface EmailRecipient {
  email: string;
  name: string;
  detail: string;
}

export interface RecipientGroups {
  teachers: EmailRecipient[];
  admins: EmailRecipient[];
  guardians: EmailRecipient[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INACTIVE = new Set(["inactive", "disabled", "suspended", "deleted", "archived"]);
const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

/**
 * Everyone the developer may email, straight from the database: teachers and admins (their login
 * emails) and guardians (students.guardian_email, one entry per address). Student login emails are
 * synthetic and are left out. The send route re-checks against this same list, so the composer
 * can't be used to mail an arbitrary address.
 */
export async function loadRecipientGroups(service: SupabaseClient): Promise<RecipientGroups> {
  const [{ data: staff }, { data: students }] = await Promise.all([
    service.from("users").select("display_name, email, role, status, staff_id").in("role", ["teacher", "admin"]),
    service.from("students").select("name, guardian_email, classes:class_id(name)").not("guardian_email", "is", null).neq("guardian_email", ""),
  ]);

  const teachers: EmailRecipient[] = [];
  const admins: EmailRecipient[] = [];
  const seenStaff = new Set<string>();
  for (const u of (staff || []) as any[]) {
    const email = String(u.email || "").trim();
    if (!EMAIL_RE.test(email) || INACTIVE.has(String(u.status || "").toLowerCase())) continue;
    const key = `${u.role}:${email.toLowerCase()}`;
    if (seenStaff.has(key)) continue;
    seenStaff.add(key);
    const entry = { email, name: u.display_name || email, detail: u.staff_id ? `Staff ID ${u.staff_id}` : "" };
    (u.role === "admin" ? admins : teachers).push(entry);
  }

  const byEmail = new Map<string, { email: string; wards: string[]; classes: Set<string> }>();
  for (const s of (students || []) as any[]) {
    const email = String(s.guardian_email || "").trim();
    if (!EMAIL_RE.test(email)) continue;
    const key = email.toLowerCase();
    const entry = byEmail.get(key) || { email, wards: [], classes: new Set<string>() };
    if (s.name) entry.wards.push(s.name);
    const cls = one(s.classes as any)?.name;
    if (cls) entry.classes.add(cls);
    byEmail.set(key, entry);
  }
  const guardians: EmailRecipient[] = Array.from(byEmail.values()).map((g) => ({
    email: g.email,
    name: g.wards.length ? `Guardian of ${g.wards.join(", ")}` : g.email,
    detail: Array.from(g.classes).join(", "),
  }));

  const byName = (a: EmailRecipient, b: EmailRecipient) => a.name.localeCompare(b.name);
  return { teachers: teachers.sort(byName), admins: admins.sort(byName), guardians: guardians.sort(byName) };
}
