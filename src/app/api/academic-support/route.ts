import {NextRequest,NextResponse} from "next/server";
import {requireApiActor,canManageClass,type ApiActor} from "@/lib/apiAuth";
import {fetchAll} from "@/lib/fetchAll";

async function flags(actor:ApiActor,classId:string,sessionId:string,threshold:number) {
  const snapshots=await fetchAll((a,b)=>actor.service.from("result_snapshots")
    .select("id,enrollment_id,term,report_type,snapshot_data,student_enrollments!inner(class_id,academic_session_id,status)")
    .eq("student_enrollments.class_id",classId).eq("student_enrollments.academic_session_id",sessionId)
    .eq("student_enrollments.status","active").order("term").order("report_type").order("id").range(a,b));
  type Flag={enrollment:string;subjectId:string;subject:string;name:string;trend:{period:string;score:number}[]};
  const grouped=new Map<string,Flag>();
  for(const row of snapshots) for(const subject of row.snapshot_data?.subjects || []) {
    const score=row.report_type==="TR"?subject.total:subject.percentage;
    if (!Number.isFinite(score)) continue;
    const key=row.enrollment_id+"/"+subject.subjectId;
    const f:Flag=grouped.get(key) || {enrollment:row.enrollment_id,subjectId:subject.subjectId,subject:subject.name,name:row.snapshot_data.student?.name,trend:[]};
    f.trend.push({period:row.term+" "+row.report_type,score});
    grouped.set(key,f);
  }
  return Array.from(grouped.values()).filter(f=>f.trend[f.trend.length-1].score<threshold);
}
async function context(actor:ApiActor) {
  const [s,p]=await Promise.all([actor.service.from("academic_sessions").select("id,name").eq("is_current",true).maybeSingle(),
    actor.service.from("support_policy").select("threshold").eq("id",true).maybeSingle()]);
  if(s.error || p.error) throw Error("Support settings unavailable");
  return {session:s.data,threshold:p.data?.threshold??null};
}
export async function GET(req:NextRequest) {
  const auth=await requireApiActor(req,["admin","teacher"]);
  if ("response" in auth) return auth.response;
  const actor=auth.actor;
  try {
    return await loadSupport(actor,req.nextUrl.searchParams.get("classId"));
  } catch (error) {
    console.error("Academic support load failed:",error);
    return NextResponse.json({error:"Could not load academic support. Please retry."},{status:503});
  }
}
async function loadSupport(actor:ApiActor,classId:string|null) {
  const {session,threshold}=await context(actor);
  if(!classId) {
    const ids=[actor.authId,actor.dbUserId].filter(Boolean) as string[];
    const classes=await actor.service.from("classes").select("id,name").order("name").throwOnError();
    const assignments=actor.role==="teacher" && session ? await actor.service.from("class_teacher_assignments").select("class_id")
      .eq("academic_session_id",session.id).eq("status","active").in("teacher_user_id",ids).throwOnError():null;
    const assigned=new Set(assignments?.data?.map(r=>r.class_id));
    return NextResponse.json({session,threshold,classes:classes.data.filter(c=>actor.role==="admin" || assigned.has(c.id)).map(({id,name})=>({id,name}))});
  }
  if (!session || !await canManageClass(actor,classId,session.id)) return NextResponse.json({error:"Class unavailable."},{status:403});
  const rows=threshold===null?[]:await flags(actor,classId,session.id,threshold);
  const notes=await fetchAll((a,b)=>actor.service.from("support_notes").select("id,enrollment_id,subject_name,note,created_at,evidence,threshold,student_enrollments!inner(class_id,academic_session_id,students(name))")
    .eq("student_enrollments.class_id",classId).eq("student_enrollments.academic_session_id",session.id).order("created_at",{ascending:false}).order("id").range(a,b));
  return NextResponse.json({rows,notes,threshold});
}
export async function POST(req:NextRequest) {
  const auth=await requireApiActor(req,["admin","teacher"]);
  if ("response" in auth) return auth.response;
  const actor=auth.actor,b=await req.json().catch(()=>null);
  if(b?.action==="threshold" && actor.role==="admin" && typeof b.threshold==="number" && Number.isFinite(b.threshold) && b.threshold>=0 && b.threshold<=100) {
    await actor.service.from("support_policy").upsert({id:true,threshold:b.threshold}).throwOnError();
    return NextResponse.json({ok:true});
  }
  const {session,threshold}=await context(actor);
  if(actor.role!=="teacher" || !session || threshold===null || !await canManageClass(actor,b?.classId,session.id)) return NextResponse.json({error:"Class teacher access required."},{status:403});
  const note=String(b?.message||"").trim();
  if(!note || note.length>2000) return NextResponse.json({error:"Enter a follow-up of up to 2,000 characters."},{status:400});
  const flag=(await flags(actor,b.classId,session.id,threshold)).find(f=>f.enrollment===b.enrollment && f.subjectId===b.subjectId);
  if(!flag) return NextResponse.json({error:"This flag has changed. Refresh the class."},{status:409});
  await actor.service.from("support_notes").insert({enrollment_id:flag.enrollment,subject_id:flag.subjectId,subject_name:flag.subject,evidence:flag.trend,threshold,note,author:actor.dbUserId}).throwOnError();
  return NextResponse.json({ok:true});
}
