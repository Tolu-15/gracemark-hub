import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as auth from "@/lib/apiAuth";
import * as finance from "@/lib/financeServer";
import * as cards from "@/lib/scratchCards";
import { POST } from "./route";

test("a correction uses the student's original published enrollment and subject", async t => {
  let saved:any;
  const snapshot={published_at:"fixture-publication",snapshot_data:{subjects:[{subjectId:"math",name:"Mathematics"}]}};
  const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:snapshot})};
  const service={from:(table:string)=>table==="result_snapshots"?query:{insert:async(row:unknown)=>{saved=row;return {error:null}}}};
  t.mock.method(auth,"requireApiActor",async()=>({actor:{service,role:"student",authId:"account"}}));
  t.mock.method(finance,"findStudentForActor",async()=>({id:"own-pupil"}));
  t.mock.method(cards,"findEnrollment",async(_db:unknown,pupil:string,session:string)=>{
    assert.equal(pupil,"own-pupil");assert.equal(session,"2025/2026");
    return {enrollmentId:"original-placement",sessionId:"old-session"};
  });
  const submit=(extra:object)=>POST(new NextRequest("https://example.test/api/result-corrections",{method:"POST",body:JSON.stringify({
    term:"term1",session:"2025/2026",milestone:"PR1",message:"Please check my test score.",publishedAt:"fixture-publication",subjectId:"math",...extra
  })}));
  assert.equal((await submit({subjectId:"unpublished-subject"})).status,409);
  assert.equal((await submit({publishedAt:"previous-version"})).status,409);
  assert.equal(Boolean(saved),false);
  assert.equal((await submit({studentId:"another-pupil"})).status,200);
  assert.equal(saved.enrollment_id,"original-placement");
  assert.equal(saved.subject_name,"Mathematics");
  assert.equal(saved.term,"term1");
});
