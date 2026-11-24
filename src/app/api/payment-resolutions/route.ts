import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/apiAuth";
import { isCardIssuer } from "@/lib/scratchCards";
import { findStudentForActor } from "@/lib/financeServer";
import { fetchAll } from "@/lib/fetchAll";

export async function GET(req: NextRequest) {
  const auth = await requireApiActor(req, ["admin","student"],{allowLockedStudent:true});
  if ("response" in auth) return auth.response;
  const {service,role,authId,dbUserId} = auth.actor;
  const own = role==="student" ? await findStudentForActor(service,authId,dbUserId) : null;
  if (role==="student" && !own) return NextResponse.json({error:"Student unavailable."},{status:403});
  const groups = await Promise.all(["card","fee"].map(async source => {
    const rows = await fetchAll((from,to)=>{
    let q = service.from(source==="card"?"duplicate_card_payments":"duplicate_fee_payments").select("*");
    if (own) q=q.eq("student_id",own.id);
    return q.order("created_at",{ascending:false}).order("id").range(from,to);
  });
    return rows.map(row=>({...row,source,canResolve:role==="admin" && (source==="fee" || isCardIssuer(auth.actor))}));
  }));
  return NextResponse.json({rows:groups.flat()});
}
export async function POST(req: NextRequest) {
  const auth = await requireApiActor(req, ["admin"]);
  if ("response" in auth) return auth.response;
  const b=await req.json().catch(()=>null);
  const note=String(b?.message||"").trim();
  if (!note || note.length>2000 || !["refund","credit"].includes(b?.kind)) return NextResponse.json({error:"Choose a resolution and enter the receipt or credit details."},{status:400});
  const {service,dbUserId}=auth.actor;
  if(b.source==="fee"){
    const {data:payment}=await service.from("duplicate_fee_payments").select("amount,resolution").eq("id",b.id).maybeSingle();
    if(!payment || payment.resolution || Number(payment.amount)!==b.amount) return NextResponse.json({error:"Fee payment changed. Refresh before continuing."},{status:409});
    const {error}=await service.from("fee_payment_resolutions").insert({transaction_id:b.id,amount:payment.amount,kind:b.kind,note,recorded_by:dbUserId});
    return error?NextResponse.json({error:"Could not record this resolution. Refresh and check its status."},{status:409}):NextResponse.json({ok:true});
  }
  if (!isCardIssuer(auth.actor)) return NextResponse.json({error:"Finance authorisation required."},{status:403});
  const {data:p}=await service.from("scratch_card_purchases").select("amount,refunded_amount").eq("id",b.id).eq("status","duplicate").maybeSingle();
  if (!p || Number(p.refunded_amount)>=Number(p.amount) || (b.kind==="credit" && Number(p.refunded_amount)>0))
    return NextResponse.json({error:"Check the refund already recorded for this payment."},{status:409});
  const saved=await service.from("scratch_card_purchases").update({resolution:b.kind,resolution_note:note,resolved_at:new Date().toISOString(),resolved_by:dbUserId,
    refunded_amount:b.kind==="refund"?p.amount:0}).eq("id",b.id).eq("status","duplicate").is("resolution",null).eq("refunded_amount",p.refunded_amount).select("id").maybeSingle();
  return saved.data ? NextResponse.json({ok:true}) : NextResponse.json({error:"Payment changed. Refresh before recording a resolution."},{status:409});
}
