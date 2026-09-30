import { NextRequest, NextResponse } from "next/server";
import { requireApiActor, ApiActor } from "@/lib/apiAuth";
import { logAudit } from "@/lib/audit";
import { notifyRole, notifyUsers } from "@/lib/notify";
import { getCurrentContext, isTermCode, resolveSession, studentClassId, teacherClassIds, usersByAnyId } from "@/lib/serverContext";

const OPTS = { allowLockedStudent: true };

/** Announcements the actor is allowed to see, newest first (pinned on top). */
async function visibleFor(actor: ApiActor, sessionId: string, term: string | null) {
  const { service } = actor;
  let query = service
    .from("announcements")
    .select("*, classes(name)")
    .eq("academic_session_id", sessionId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);
  if (term) query = query.eq("term_code", term);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data || []) as any[];
  const now = Date.now();
  const live = (a: any) => !a.expires_at || new Date(a.expires_at).getTime() > now;

  if (actor.role === "admin") return rows.map((a) => ({ ...a, expired: !live(a) }));

  if (actor.role === "student") {
    const classId = await studentClassId(service, actor, sessionId);
    return rows
      .filter((a) => live(a) && a.audience !== "teachers" && (!a.class_id || a.class_id === classId))
      .map((a) => ({ ...a, expired: false }));
  }

  const myClasses = await teacherClassIds(service, actor, sessionId);
  return rows
    .filter(
      (a) =>
        a.author_user_id === actor.dbUserId ||
        (live(a) && ((!a.class_id && a.audience !== "students") || (a.class_id && myClasses.has(a.class_id))))
    )
    .map((a) => ({ ...a, expired: !live(a) }));
}

export async function GET(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher", "student"], OPTS);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;
  const sp = req.nextUrl.searchParams;

  try {
    const session = await resolveSession(actor.service, sp.get("session"));
    if (!session) return NextResponse.json({ ok: true, announcements: [], unreadCount: 0 });
    const termParam = sp.get("term");
    const term = isTermCode(termParam) ? termParam : null;

    const rows = await visibleFor(actor, session.id, term);
    const ids = rows.map((r) => r.id);
    const { data: reads } = ids.length
      ? await actor.service.from("announcement_reads").select("announcement_id").eq("reader_auth_id", actor.authId).in("announcement_id", ids)
      : { data: [] as any[] };
    const readSet = new Set((reads || []).map((r: any) => r.announcement_id));

    const withRead = rows.map((a) => ({
      ...a,
      mine: !!actor.dbUserId && a.author_user_id === actor.dbUserId,
      unread: !readSet.has(a.id) && !a.expired && a.author_user_id !== actor.dbUserId,
    }));
    const unreadCount = withRead.filter((a) => a.unread).length;

    if (sp.get("summary") === "1") return NextResponse.json({ ok: true, unreadCount });

    // Classes this person may address when posting (teachers: only their own this session).
    let postableClasses: { id: string; name: string }[] = [];
    if (actor.role === "admin") {
      const { data } = await actor.service.from("classes").select("id, name").order("name");
      postableClasses = data || [];
    } else if (actor.role === "teacher") {
      const ctx = await getCurrentContext(actor.service);
      const mine = ctx ? Array.from(await teacherClassIds(actor.service, actor, ctx.sessionId)) : [];
      if (mine.length) {
        const { data } = await actor.service.from("classes").select("id, name").in("id", mine).order("name");
        postableClasses = data || [];
      }
    }
    return NextResponse.json({ ok: true, session: session.name, announcements: withRead, unreadCount, postableClasses });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || "Could not load announcements." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiActor(req, ["admin", "teacher"], OPTS);
  if ("response" in authorization) return authorization.response;
  const { actor } = authorization;

  const body = await req.json().catch(() => null);
  const title = String(body?.title || "").trim();
  const text = String(body?.body || "").trim();
  if (!title || title.length > 160) return NextResponse.json({ ok: false, error: "A title (up to 160 characters) is required." }, { status: 400 });
  if (!text || text.length > 5000) return NextResponse.json({ ok: false, error: "A message (up to 5000 characters) is required." }, { status: 400 });

  const ctx = await getCurrentContext(actor.service);
  if (!ctx) return NextResponse.json({ ok: false, error: "No current academic session is set in Settings." }, { status: 400 });

  let audience = ["everyone", "students", "teachers"].includes(body?.audience) ? body.audience : "everyone";
  let classId: string | null = body?.class_id ? String(body.class_id) : null;
  let pinned = Boolean(body?.pinned);

  if (actor.role === "teacher") {
    // Teachers can only address the classes they teach this session.
    if (!classId) return NextResponse.json({ ok: false, error: "Choose one of your classes." }, { status: 400 });
    const mine = await teacherClassIds(actor.service, actor, ctx.sessionId);
    if (!mine.has(classId)) return NextResponse.json({ ok: false, error: "You can only post to classes you teach." }, { status: 403 });
    audience = "everyone";
    pinned = false;
  }
  if (classId) {
    const { data: cls } = await actor.service.from("classes").select("id").eq("id", classId).maybeSingle();
    if (!cls) return NextResponse.json({ ok: false, error: "Class not found." }, { status: 400 });
  }

  let expiresAt: string | null = null;
  if (body?.expires_at) {
    const d = new Date(body.expires_at);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ ok: false, error: "Invalid expiry date." }, { status: 400 });
    expiresAt = d.toISOString();
  }

  const { data: me } = actor.dbUserId
    ? await actor.service.from("users").select("display_name, email").eq("id", actor.dbUserId).maybeSingle()
    : { data: null as any };

  const { data, error } = await actor.service
    .from("announcements")
    .insert({
      academic_session_id: ctx.sessionId,
      term_code: ctx.term,
      title,
      body: text,
      audience,
      class_id: classId,
      pinned,
      expires_at: expiresAt,
      author_user_id: actor.dbUserId ?? null,
      author_name: me?.display_name || me?.email || actor.email || "Staff",
      author_role: actor.role,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAudit(actor, {
    action: "announcement.post",
    entityType: "announcement",
    entityId: data.id,
    summary: `Posted announcement "${title}" (${classId ? "class" : audience}) — ${ctx.sessionName}, ${ctx.term}`,
    metadata: { audience, class_id: classId, pinned },
  });

  const notifyEntry = {
    type: "announcement.post",
    title: `New announcement: ${title}`,
    body: text.length > 140 ? `${text.slice(0, 140)}…` : text,
    link: actor.role === "student" ? "/student/announcements" : "/teacher/announcements",
  };
  if (classId) {
    const { data: classStudents } = await actor.service.from("students").select("user_id").eq("class_id", classId);
    const rawIds = (classStudents || []).map((s: any) => s.user_id).filter(Boolean);
    if (rawIds.length) {
      const userMap = await usersByAnyId(actor.service, rawIds);
      const recipientIds = Array.from(new Set(Array.from(userMap.values()).map((u) => u.id)));
      await notifyUsers(actor, recipientIds, { ...notifyEntry, link: "/student/announcements" });
    }
  } else if (audience === "teachers") {
    await notifyRole(actor, "teacher", { ...notifyEntry, link: "/teacher/announcements" });
  } else if (audience === "students") {
    await notifyRole(actor, "student", { ...notifyEntry, link: "/student/announcements" });
  } else {
    await notifyRole(actor, "teacher", { ...notifyEntry, link: "/teacher/announcements" });
    await notifyRole(actor, "student", { ...notifyEntry, link: "/student/announcements" });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
