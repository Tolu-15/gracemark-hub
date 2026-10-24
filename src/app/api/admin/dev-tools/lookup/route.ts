import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, requireDeveloper } from "@/lib/apiAuth";

/** GET ?q= — full linked record for a student: student row + login + auth status, in one place. */
export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin"]);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  if (!(await requireDeveloper(actor))) return NextResponse.json({ ok: false, error: "Developer tools access required." }, { status: 403 });
  const { service } = actor;

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ ok: false, error: "q is required." }, { status: 400 });

  const { data: students, error } = await service
    .from("students")
    .select("id, name, full_name, admission_no, gender, user_id, class_id, current_class_id, portal_access_status, classes:class_id(name)")
    .or(`name.ilike.%${q}%,full_name.ilike.%${q}%,admission_no.ilike.%${q}%`)
    .limit(10);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const results = await Promise.all(
    (students || []).map(async (s: any) => {
      const { data: user } = await service.from("users").select("id, auth_id, email, display_name, status, must_change_password, created_at").eq("id", s.user_id).maybeSingle();
      let auth: any = null;
      if (user?.auth_id) {
        const { data: authUser } = await service.auth.admin.getUserById(user.auth_id);
        if (authUser?.user) {
          auth = {
            email: authUser.user.email,
            email_confirmed_at: authUser.user.email_confirmed_at,
            last_sign_in_at: authUser.user.last_sign_in_at,
            created_at: authUser.user.created_at,
          };
        }
      }
      return {
        student: { id: s.id, name: s.full_name || s.name, admission_no: s.admission_no, gender: s.gender, class: s.classes?.name || null, portal_access_status: s.portal_access_status },
        login: user ? { id: user.id, email: user.email, display_name: user.display_name, status: user.status, must_change_password: user.must_change_password } : null,
        auth,
      };
    })
  );

  return NextResponse.json({ ok: true, results });
}
