import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getPaystackPublicKey } from "@/lib/financeServer";

export async function GET() {
  return NextResponse.json({ ok: true, public_key: await getPaystackPublicKey(getServiceClient()) });
}
