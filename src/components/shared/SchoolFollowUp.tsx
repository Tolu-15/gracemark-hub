"use client";

import {useEffect,useState, type FormEvent} from "react";
import {getAuthHeaders} from "@/lib/supabase/client";

type Report={session:string;term:string;milestone:string;publishedAt:string;subjects:{subjectId:string;name:string}[]};
type FormValues=Record<string,string>;
const field="rounded border border-slate-300 p-2";
const button="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";

async function request(url:string,body?:object) {
  const res=await fetch(url,{headers:{...(await getAuthHeaders()),"Content-Type":"application/json"},cache:"no-store",
    ...(body?{method:"POST",body:JSON.stringify(body)}:{})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw Error(data.error || "Could not complete this request. Please retry.");
  return data;
}
function useRows(url:string) {
  const [version,setVersion]=useState(0);
  const [state,setState]=useState<{url:string;version:number;data:any;error?:string}>();
  useEffect(()=>{
    let active=true;
    if(url) request(url).then(data=>{if(active)setState({url,version,data})}).catch(e=>{if(active)setState({url,version,data:null,error:e.message})});
    return ()=>{active=false};
  },[url,version]);
  const current=state?.url===url && state?.version===version?state:null;
  return {data:current?.data,error:current?.error,status:current?.error || (!current && url?"Loading…":""),reload:()=>setVersion(v=>v+1)};
}
function ActionForm({children,label,save}:{children:React.ReactNode;label:string;save:(v:FormValues)=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[msg,setMsg]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();const form=e.currentTarget;
    setBusy(true);setMsg("");
    try {await save(Object.fromEntries(new FormData(form)) as FormValues);form.reset();setMsg("Saved.");}
    catch(error){setMsg(error instanceof Error?error.message:"Could not save.");}
    finally{setBusy(false);}
  }
  return <form onSubmit={submit} className="my-2 flex flex-wrap items-center gap-2">{children}<button className={button} disabled={busy}>{busy?"Saving…":label}</button><span role="status">{msg}</span></form>;
}
const note=(label:string)=><textarea name="message" aria-label={label} placeholder={label} required maxLength={2000} className={field}/>;
const box="my-4 space-y-3 rounded-xl border bg-white p-4 text-sm print:hidden";
export function CorrectionForm({report}:{report:Report}) {
  return <section className={box}><h2 className="font-bold">Request a result correction</h2>
    <ActionForm label="Send request" save={async v=>{await request("/api/result-corrections",{session:report.session,term:report.term,milestone:report.milestone,publishedAt:report.publishedAt,...v})}}>
      <select name="subjectId" required aria-label="Report subject" defaultValue="" className={field}><option value="" disabled>Select subject</option>{report.subjects.map(s=><option key={s.subjectId} value={s.subjectId}>{s.name}</option>)}</select>{note("Explain your concern")}
    </ActionForm><a className="underline" href="/student/corrections">Track correction requests</a></section>;
}
export function Corrections({admin=false}:{admin?:boolean}) {
  const {data,status,reload}=useRows("/api/result-corrections");
  return <section className={box}><h1 className="text-lg font-bold">Result correction requests</h1><p role="status">{status}</p>
    {data?.rows.length===0 && <p>No requests yet.</p>}
    {data?.rows.map((r:any)=><article className="border-t py-3" key={r.id}><strong>{r.student_enrollments?.students?.name} · {r.subject_name}</strong>
      <p>{r.student_enrollments?.academic_sessions?.name} · {r.term} · {r.milestone}</p><p>{r.concern}</p><p>{r.response?"School response: "+r.response:"Awaiting school response"}</p>
      {admin && !r.response && <ActionForm label="Send response" save={async v=>{await request("/api/result-corrections",{id:r.id,...v});reload()}}>{note("Reply to the family")}</ActionForm>}</article>)}</section>;
}
export function PaymentResolutions() {
  const {data,status,reload}=useRows("/api/payment-resolutions");
  return <section className={box}><h2 className="font-bold">Duplicate payments</h2><p role="status">{status}</p>{data?.rows.length===0 && <p>No duplicate payments.</p>}
    {data?.rows.map((r:any)=><article key={r.id} className="border-t py-3"><strong>{r.source==="fee"?"School fees":"Result card"} · {r.student_name} · {r.session} · {r.term_code}</strong>
      <p>Original card or payment: {r.original_reference || "Reference unavailable"}</p><p>Additional payment: {r.reference} · Amount for resolution: ₦{r.amount}</p>
      <p>{r.resolution==="credit"?"Credit recorded":r.resolution==="refund"?"Refund recorded":"Awaiting resolution"} {r.resolution_note}</p>
      {Number(r.refunded_amount)>0 && <p>Already refunded: ₦{r.refunded_amount}</p>}
      {r.canResolve && !r.resolution && <ActionForm label="Record completed resolution" save={async v=>{await request("/api/payment-resolutions",{id:r.id,source:r.source,amount:Number(r.amount),...v});reload()}}>
        <select className={field} aria-label="Resolution" name="kind"><option value="refund">Full refund paid</option>{!Number(r.refunded_amount) && <option value="credit">Full credit issued</option>}</select>{note("Receipt or credit details for the family")}</ActionForm>}</article>)}</section>;
}
const trend=(points:any[])=>points.map(p=>p.period+" "+p.score+"%").join(" → ");
export function AcademicSupport({admin=false}:{admin?:boolean}) {
  const policy=useRows("/api/academic-support"),[classId,setClassId]=useState("");
  const records=useRows(classId?"/api/academic-support?classId="+encodeURIComponent(classId):"");
  if (!policy.data) return <section className={box}><h1 className="text-lg font-bold">Academic support</h1>
    <p role="status">{policy.status}</p>{policy.error && <button type="button" className={button} onClick={policy.reload}>Retry</button>}</section>;
  return <section className={box}><h1 className="text-lg font-bold">Academic support</h1><p>{policy.data.session?.name}</p>
    <p>{policy.data?.threshold!=null?"Flag subjects whose latest published score is below "+policy.data.threshold+"%.":"The school has not set a score threshold."}</p>
    {admin && policy.data && <ActionForm label="Save threshold" save={async v=>{await request("/api/academic-support",{action:"threshold",threshold:Number(v.threshold)});policy.reload();records.reload()}}>
      <label>Score threshold (%) <input className={field} name="threshold" type="number" min="0" max="100" step="0.1" defaultValue={policy.data.threshold} required/></label></ActionForm>}
    <select className={field} aria-label="Class" value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Select class</option>{policy.data?.classes.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <p>{records.status}</p>{policy.data.threshold!=null && records.data?.rows.length===0 && <p>No pupils currently flagged in this class.</p>}
    {records.data?.rows.map((r:any)=><article className="border-t py-2" key={r.enrollment+r.subjectId}><strong>{r.name} · {r.subject}</strong><p>{trend(r.trend)}</p>
      {!admin && <ActionForm label="Record follow-up" save={async v=>{await request("/api/academic-support",{classId,enrollment:r.enrollment,subjectId:r.subjectId,...v});records.reload()}}>{note("What follow-up did you take?")}</ActionForm>}</article>)}
    {!!records.data?.notes.length && <h2 className="font-bold">Recorded follow-ups</h2>}
    {records.data?.notes.map((n:any)=><article className="border-t py-2" key={n.id}><strong>{n.student_enrollments?.students?.name} · {n.subject_name}</strong><p>{new Date(n.created_at).toLocaleDateString()} · {n.note}</p><p>{trend(n.evidence)} · Threshold {n.threshold}%</p></article>)}</section>;
}
