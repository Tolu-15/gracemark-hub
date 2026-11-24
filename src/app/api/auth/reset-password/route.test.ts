import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as database from "@/lib/supabase/server";
import { POST } from "./route";

test("submitting one reset grant twice changes the password once", async t => {
  let claimed = false;
  let changes = 0;
  const service = {
    rpc: async (name:string) => {
      assert.equal(name,"claim_reset_token");
      const available = !claimed;
      claimed = true;
      return {data:available,error:null};
    },
    auth:{admin:{updateUserById:async()=>{changes++;return {error:null}}}},
    from:()=>({
      update:()=>({eq:async()=>({error:null})}),
      select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})
    })
  };
  t.mock.method(database,"getServiceClient",()=>service);
  const submit=()=>POST(new NextRequest("https://example.test/api/auth/reset-password",{
    method:"POST",body:JSON.stringify({action:"reset",auth_id:"fixture",reset_token:"one-grant",new_password:"fixture-password"})
  }));
  assert.equal((await submit()).status,200);
  assert.equal((await submit()).status,401);
  assert.equal(changes,1);
});
