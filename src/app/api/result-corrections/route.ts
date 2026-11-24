import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { findStudentForActor } from "@/lib/financeServer";
import { findEnrollment, getCardState } from "@/lib/scratchCards";
import { fetchAll } from "@/lib/fetchAll";

export async function GET(req: NextRequest) {
  const auth = await requireApiActor(req, ["admin","student"]);
  if ("response" in auth) return auth.response;
  const {service,role,authId,dbUserId} = auth.actor;
  const own = role === "student" ? await findStudentForActor(service,authId,dbUserId) : null;
  if (role === "student" && !own) return NextResponse.json({error:"Student profile unavailable."},{status:403});
  const rows = await fetchAll((from,to) => {
    let query = service.from("result_corrections").select("id,term,milestone,subject_name,concern,response,created_at,responded_at,student_enrollments!inner(student_id,students(name),academic_sessions(name))");
    if (own) query = query.eq("student_enrollments.student_id",own.id);
    return query.order("created_at",{ascending:false}).order("id").range(from,to);
  });
  return NextResponse.json({rows});
}

export async function POST(req: NextRequest) {
  const auth = await requireApiActor(req, ["student","admin"]);
  if ("response" in auth) return auth.response;
  const {service,role,authId,dbUserId} = auth.actor;
  const body = await req.json().catch(()=>null);
  const message = String(body?.message || "").trim();
  if (!message || message.length>2000) return NextResponse.json({error:"Enter a message of up to 2,000 characters."},{status:400});
  if (role === "admin") {
    const saved = await service.from("result_corrections").update({response:message,responded_by:dbUserId,responded_at:new Date().toISOString()})
      .eq("id",body.id).is("response",null).select("id").maybeSingle();
    return saved.data ? NextResponse.json({ok:true}) : NextResponse.json({error:"Request unavailable or already answered."},{status:409});
  }
  const own = await findStudentForActor(service,authId,dbUserId);
  const enrollment = own && await findEnrollment(service,own.id,body.session);
  if (!enrollment) return NextResponse.json({error:"Enrollment unavailable."},{status:404});
  if (body.milestone === "TR" && (await getCardState(service,own!.id,enrollment.sessionId,body.term))?.status !== "active")
    return NextResponse.json({error:"Open the terminal report with your card first."},{status:403});
  const {data:snapshot} = await service.from("result_snapshots").select("published_at,snapshot_data")
    .eq("enrollment_id",enrollment.enrollmentId).eq("term",body.term).eq("report_type",body.milestone).maybeSingle();
  const subject = snapshot?.snapshot_data?.subjects?.find((s:{subjectId:string})=>s.subjectId===body.subjectId);
  if (!subject || snapshot?.published_at !== body.publishedAt) return NextResponse.json({error:"Reopen the published report before sending this request."},{status:409});
  const {error} = await service.from("result_corrections").insert({enrollment_id:enrollment.enrollmentId,term:body.term,milestone:body.milestone,
    subject_id:subject.subjectId,subject_name:subject.name,published_at:snapshot!.published_at,concern:message});
  return error ? NextResponse.json({error:error.code==="23505"?"An open request already exists for this subject.":"Could not save the request."},{status:409}) : NextResponse.json({ok:true});
}
