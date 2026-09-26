import { PAYMENTS_ENABLED } from "@/lib/features";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  REF_PREFIX,
  getActiveAdmissionForm,
  getPaystackPublicKey,
  newReceiptNumber,
  newReference,
  rateLimited,
} from "@/lib/financeServer";

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/**
 * Public admission application. The price comes from the active admission form, never the browser.
 * The application is saved as an unpaid "draft" with a pending payment; it becomes "submitted"
 * only after the server confirms the payment with Paystack. No account or password is involved.
 */
export async function POST(req: NextRequest) {
  if (!PAYMENTS_ENABLED) return NextResponse.json({ error: "Admissions are coming soon." }, { status: 503 });
  const service = getServiceClient();
  if (!service) return NextResponse.json({ error: "Applications are temporarily unavailable." }, { status: 503 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(`apply:${ip}`, 8, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  let b: any;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = text(b.parent_email, 200).toLowerCase();
  const gender = b.gender === "M" ? "male" : b.gender === "F" ? "female" : "";
  const photo = text(b.passport_photo_url, 500);
  const classId = text(b.desired_class_id, 64);

  const required = [
    b.surname, b.first_names, b.date_of_birth, gender, classId, b.state_of_origin,
    b.home_address, b.previous_school_name, b.parent_name, b.parent_phone,
  ];
  if (required.some((v) => !text(v, 500)) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please complete all required fields with a valid parent email." }, { status: 400 });
  }
  if (photo && !/^https?:\/\//i.test(photo)) {
    return NextResponse.json({ error: "Passport photo must be a web link starting with http(s)://." }, { status: 400 });
  }

  try {
    const form = await getActiveAdmissionForm(service);
    if (!form) return NextResponse.json({ error: "Admissions are not open right now." }, { status: 409 });

    const { data: cls } = await service.from("classes").select("id").eq("id", classId).maybeSingle();
    if (!cls) return NextResponse.json({ error: "Please choose a valid class." }, { status: 400 });

    const amount = Number(form.amount);
    const reference = newReference(REF_PREFIX.admission);

    const { data: payment, error: payErr } = await service
      .from("admission_payments")
      .insert({
        admission_form_id: form.id,
        applicant_email: email,
        applicant_phone: text(b.parent_phone, 30),
        amount,
        payment_reference: reference,
        receipt_number: newReceiptNumber(),
        gateway: "paystack",
        status: "pending",
      })
      .select("id")
      .single();
    if (payErr || !payment) throw payErr || new Error("payment row not created");

    const applicationNumber = `ADM-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const boarding = Boolean(b.is_boarding);

    const { data: admission, error } = await service
      .from("admissions")
      .insert({
        application_number: applicationNumber,
        admission_form_id: form.id,
        admission_payment_id: payment.id,
        surname: text(b.surname, 100),
        first_names: text(b.first_names, 150),
        gender,
        date_of_birth: text(b.date_of_birth, 20),
        state_of_origin: text(b.state_of_origin, 80),
        home_address: text(b.home_address, 300),
        passport_url: photo || null,
        previous_school_name: text(b.previous_school_name, 200),
        previous_school_address: text(b.previous_school_address, 300) || null,
        previous_class: text(b.previous_class, 60) || null,
        is_boarding: boarding,
        boarding_type: boarding ? (b.boarding_type === "weekday" ? "weekday" : "full") : null,
        medical_conditions: text(b.medical_conditions, 1000) || null,
        desired_class_id: cls.id,
        parent_name: text(b.parent_name, 150),
        parent_phone: text(b.parent_phone, 30),
        parent_email: email,
        parent_occupation: text(b.parent_occupation, 100) || null,
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !admission) {
      await service.from("admission_payments").delete().eq("id", payment.id);
      throw error || new Error("admission row not created");
    }

    return NextResponse.json({
      ok: true,
      admission_id: admission.id,
      application_number: applicationNumber,
      reference,
      amount,
      email,
      public_key: await getPaystackPublicKey(service),
    });
  } catch (err) {
    console.error("admissions apply error:", err);
    return NextResponse.json({ error: "Could not save your application. Please try again." }, { status: 500 });
  }
}
