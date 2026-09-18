import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    createAuthUserApi: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}
