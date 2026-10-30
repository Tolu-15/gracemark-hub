import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { sendCustomEmail } from "@/lib/email";

type TurnstileResult = { success?: boolean };

const feedbackTypes = new Set(["suggestion", "technical_issue", "general_feedback"]);

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid form submission." }, { status: 400 });
  }

  // Bots tend to populate every field. Real visitors never see this field.
  if (cleanText(body.website, 200)) {
    return NextResponse.json({ ok: true });
  }

  const name = cleanText(body.name, 120);
  const email = cleanText(body.email, 254);
  const feedbackType = cleanText(body.feedback_type, 40);
  const message = cleanText(body.message, 3000);
  const token = cleanText(body.turnstile_token, 2048);
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!feedbackTypes.has(feedbackType) || message.length < 10) {
    return NextResponse.json({ error: "Please select a feedback type and enter at least 10 characters." }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address or leave it blank." }, { status: 400 });
  }
  if (!secret) {
    return NextResponse.json({ error: "Feedback verification is not configured yet." }, { status: 503 });
  }
  if (!token) {
    return NextResponse.json({ error: "Please complete the human verification." }, { status: 400 });
  }

  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";
  const remoteip = forwarded.split(",")[0].trim();
  const verificationBody = new URLSearchParams({ secret, response: token });
  if (remoteip) verificationBody.set("remoteip", remoteip);

  try {
    const verificationResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verificationBody,
      cache: "no-store",
    });
    const verification = (await verificationResponse.json()) as TurnstileResult;
    if (!verificationResponse.ok || !verification.success) {
      return NextResponse.json({ error: "Human verification failed. Please try again." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Human verification is temporarily unavailable. Please try again." }, { status: 503 });
  }

  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Feedback service is unavailable." }, { status: 503 });
  }

  const { error: saveError } = await service.from("feedback_submissions").insert({
    name: name || null,
    email: email || null,
    feedback_type: feedbackType,
    message,
    source_page: "/feedback",
  });
  if (saveError) {
    console.error("Feedback save error:", saveError);
    return NextResponse.json({ error: "Your feedback could not be saved. Please try again." }, { status: 500 });
  }

  const developerEmail = process.env.T_DEV_FEEDBACK_EMAIL;
  if (developerEmail) {
    try {
      await sendCustomEmail({
        toEmail: developerEmail,
        toName: "T_dev",
        subject: `New Gracemark feedback: ${feedbackType.replace(/_/g, " ")}`,
        message: `Name: ${name || "Not provided"}\nEmail: ${email || "Not provided"}\nType: ${feedbackType.replace(/_/g, " ")}\n\n${message}`,
      });
    } catch (error) {
      // Saving feedback succeeds even when email delivery is temporarily unavailable.
      console.error("Feedback notification error:", error);
    }
  }

  return NextResponse.json({ ok: true });
}
