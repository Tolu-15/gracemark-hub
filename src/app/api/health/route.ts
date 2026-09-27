import { NextResponse } from "next/server";

export async function GET() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return NextResponse.json({
    ok: true,
    createAuthUserApi: Boolean(serviceRoleKey),
  });
}
