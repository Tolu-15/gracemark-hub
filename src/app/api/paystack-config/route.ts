import { NextResponse } from "next/server";

export async function GET() {
  const publicKey =
    process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ||
    process.env.PAYSTACK_PUBLIC_KEY ||
    "";

  return NextResponse.json({
    ok: true,
    public_key: publicKey,
  });
}
