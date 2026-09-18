const http = require("http");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const HOST = "127.0.0.1";
/** Avoid 5500 — VS Code Live Server uses that port by default. */
let PORT = Number(process.env.PORT) || 5502;
const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, "public");
const { pages: routeToFile } = require("./public/routes.cjs");
const { url: CONFIG_URL, anonKey: CONFIG_ANON_KEY } = require("./supabase.config.cjs");

loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || CONFIG_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || CONFIG_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/** URL prefixes that map into the `public/` folder (Firebase + local dev). */
const PUBLIC_ASSET_PREFIXES = [
  { urlPrefix: "/public/", diskPrefix: "" },
  { urlPrefix: "/js/", diskPrefix: "js/" },
  { urlPrefix: "/assets/", diskPrefix: "assets/" },
  { urlPrefix: "/shared/", diskPrefix: "shared/" },
];

let wsTransport;
try {
  wsTransport = require("ws");
} catch (_) {
  wsTransport = class DummyWebSocket {};
}

let serviceClient = null;
function getServiceClient() {
  if (!SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!serviceClient) {
    serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: wsTransport },
    });
  }
  return serviceClient;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function safePathFromBase(base, relativePath) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolute = path.join(base, normalized);
  if (!absolute.startsWith(base)) return null;
  return absolute;
}

function resolvePagePath(urlPath) {
  if (routeToFile[urlPath]) return routeToFile[urlPath];
  if (!urlPath.endsWith("/") && routeToFile[`${urlPath}/`]) return routeToFile[`${urlPath}/`];
  return null;
}

function tryServePublicAsset(urlPath) {
  for (const { urlPrefix, diskPrefix } of PUBLIC_ASSET_PREFIXES) {
    if (!urlPath.startsWith(urlPrefix)) continue;
    const rel = diskPrefix + urlPath.slice(urlPrefix.length);
    const filePath = safePathFromBase(PUBLIC_ROOT, rel);
    if (!filePath) return null;
    return filePath;
  }
  return null;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendFile(res, absolutePath, statusCode = 200) {
  fs.readFile(absolutePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    res.writeHead(statusCode, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function sendNotFound(res) {
  const notFoundPath = path.join(PUBLIC_ROOT, "404.html");
  fs.stat(notFoundPath, (err, stats) => {
    if (!err && stats.isFile()) {
      sendFile(res, notFoundPath, 404);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });
}

async function verifyAdminAccessToken(accessToken) {
  const service = getServiceClient();
  if (!service) return null;

  const { data: userData, error: userError } = await service.auth.getUser(accessToken);
  if (userError || !userData?.user?.id) return null;

  const { data: profile, error: profileError } = await service
    .from("users")
    .select("role")
    .eq("auth_id", userData.user.id)
    .maybeSingle();
  if (profileError || profile?.role !== "admin") return null;

  return userData.user;
}

async function handleCreateAuthUser(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const service = getServiceClient();
  if (!service) {
    sendJson(res, 503, {
      error:
        "Admin user creation API is not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart the server.",
    });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    sendJson(res, 401, { error: "Missing admin access token." });
    return;
  }

  const adminUser = await verifyAdminAccessToken(token);
  if (!adminUser) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) {
    sendJson(res, 400, { error: "Email and password are required." });
    return;
  }

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    const message = error.message || "Failed to create auth user.";
    const status = /already|registered|exists/i.test(message) ? 409 : 400;
    sendJson(res, status, { error: message });
    return;
  }

  if (!data?.user?.id) {
    sendJson(res, 500, { error: "Supabase did not return a new user id." });
    return;
  }

  sendJson(res, 200, {
    user: { id: data.user.id, email: data.user.email ?? email },
  });
}

/**
 * Public endpoint — no admin auth required.
 * Creates an auth user via service role with email pre-confirmed.
 * Used by the student admission form so students can login immediately.
 */
async function handleRegisterStudent(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const service = getServiceClient();
  if (!service) {
    sendJson(res, 503, { error: "Service role not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.display_name || "").trim();

  if (!email || !password) {
    sendJson(res, 400, { error: "Email and password are required." });
    return;
  }

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, role: "student" },
  });

  if (error) {
    const message = error.message || "Failed to create auth user.";
    if (/already|registered|exists/i.test(message)) {
      // User already exists — find and return them
      try {
        const { data: listData } = await service.auth.admin.listUsers({ perPage: 1000 });
        const existing = (listData?.users || []).find(u => u.email === email);
        if (existing) {
          sendJson(res, 200, { user: { id: existing.id, email: existing.email }, already_exists: true });
          return;
        }
      } catch (_) {}
      sendJson(res, 409, { error: "Account already registered. Please login instead." });
      return;
    }
    sendJson(res, 400, { error: message });
    return;
  }

  if (!data?.user?.id) {
    sendJson(res, 500, { error: "Supabase did not return a user id." });
    return;
  }

  sendJson(res, 200, {
    user: { id: data.user.id, email: data.user.email ?? email },
  });
}

async function handleVerifyPaystackPayment(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const { reference, invoice_id: raw_invoice_id, student_id, amount, invoice: invoice_context } = body;
  let resolvedInvoiceId = raw_invoice_id;

  const service = getServiceClient();
  if (!service) {
    sendJson(res, 503, { error: "Server service role not configured." });
    return;
  }

  try {
    // Ensure payment_invoices row exists using Service Role key
    let { data: targetInvoice } = resolvedInvoiceId
      ? await service.from("payment_invoices").select("*").eq("id", resolvedInvoiceId).maybeSingle()
      : { data: null };

    const invoiceContext = invoice_context || {};
    const contextSession = invoiceContext.academic_session || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`;
    const contextTerm = invoiceContext.term || "term1";

    if (!targetInvoice && student_id) {
      let invoiceQuery = service
        .from("payment_invoices")
        .select("*")
        .eq("student_id", student_id)
        .eq("academic_session", contextSession);

      if (contextTerm) invoiceQuery = invoiceQuery.eq("term", contextTerm);

      const { data: matchingInvoices } = await invoiceQuery
        .order("created_at", { ascending: false })
        .limit(1);

      const stdInv = matchingInvoices?.[0] || null;

      if (stdInv) {
        targetInvoice = stdInv;
        resolvedInvoiceId = stdInv.id;
      } else {
        const invoiceNumber = `INV-${contextSession.replace(/\//g, "")}-${String(contextTerm).toUpperCase()}-${Date.now()}`;
        const { data: newInv, error: newInvErr } = await service
          .from("payment_invoices")
          .insert([{
            student_id: student_id,
            fee_structure_id: invoiceContext.fee_structure_id || null,
            class_id: invoiceContext.class_id || null,
            total_amount: Number(invoiceContext.total_amount || amount || 0),
            amount_paid: 0,
            academic_session: contextSession,
            term: contextTerm,
            status: "UNPAID",
            invoice_number: invoiceNumber
          }])
          .select()
          .maybeSingle();

        if (newInv) {
          targetInvoice = newInv;
          resolvedInvoiceId = newInv.id;
        } else if (newInvErr) {
          throw newInvErr;
        }
      }
    }

    // 1. Check if reference has already been processed
    const { data: existingRec } = await service
      .from("payment_records")
      .select("id, status, receipt_number")
      .eq("payment_reference", reference)
      .maybeSingle();

    if (existingRec && (existingRec.status === "successful" || existingRec.status === "success")) {
      sendJson(res, 200, {
        ok: true,
        verified: true,
        message: "Payment reference already verified.",
        receipt_number: existingRec.receipt_number
      });
      return;
    }

    // Use resolvedInvoiceId for all subsequent queries
    const invoice_id = resolvedInvoiceId;
    if (!invoice_id) {
      throw new Error("Could not resolve or create a payment invoice.");
    }

    // 2. Generate unique receipt number
    const year = new Date().getFullYear();
    const receiptNumber = `REC-${year}-${Math.floor(100000 + Math.random() * 900000)}`;

    // 3. Upsert payment record as verified successful
    const { data: record, error: recErr } = await service
      .from("payment_records")
      .upsert({
        invoice_id,
        student_id: student_id || null,
        payment_reference: reference,
        receipt_number: receiptNumber,
        amount: Number(amount || 0),
        payment_gateway: "paystack",
        status: "successful",
        payment_date: new Date().toISOString(),
        verified_at: new Date().toISOString()
      }, { onConflict: "payment_reference" })
      .select()
      .single();

    if (recErr) throw recErr;

    // 4. Recalculate invoice total verified paid & status
    const { data: records } = await service
      .from("payment_records")
      .select("amount")
      .eq("invoice_id", invoice_id)
      .in("status", ["successful", "success"]);

    const totalPaid = (records || []).reduce((s, r) => s + Number(r.amount || 0), 0);

    const { data: invoice } = await service
      .from("payment_invoices")
      .select("total_amount")
      .eq("id", invoice_id)
      .single();

    const totalAmount = Number(invoice?.total_amount || 0);
    const balance = Math.max(0, totalAmount - totalPaid);
    let newStatus = "UNPAID";
    if (balance <= 0 && totalAmount > 0) newStatus = "FULLY PAID";
    else if (totalPaid > 0) newStatus = "PARTIALLY PAID";

    await service
      .from("payment_invoices")
      .update({ amount_paid: totalPaid, status: newStatus })
      .eq("id", invoice_id);

    // 5. Evaluate portal access if student fully paid
    if (student_id && newStatus === "FULLY PAID") {
      const { data: policy } = await service
        .from("portal_access_settings")
        .select("auto_unlock_on_full_payment")
        .limit(1)
        .maybeSingle();

      if (policy?.auto_unlock_on_full_payment !== false) {
        await service.from("students").update({
          portal_access_status: "ACTIVE",
          portal_lock_reason: null
        }).eq("id", student_id);
      }
    }

    sendJson(res, 200, {
      ok: true,
      verified: true,
      receipt_number: receiptNumber,
      amount_paid: totalPaid,
      outstanding_balance: balance,
      status: newStatus
    });
  } catch (error) {
    console.error("Payment Verification Error:", error);
    sendJson(res, 500, { error: error.message || "Payment verification failed." });
  }
}

async function handleClassBenchmarks(req, res, parsed) {
  const classId = parsed.searchParams.get("class_id");
  const term = parsed.searchParams.get("term") || "term1";
  const session = parsed.searchParams.get("session") || "";
  const studentId = parsed.searchParams.get("student_id") || "";

  if (!classId) {
    sendJson(res, 400, { error: "class_id is required" });
    return;
  }

  const client =
    getServiceClient() ||
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { transport: wsTransport },
    });

  // 1. Fetch all students in this class
  const { data: students, error: sErr } = await client
    .from("students")
    .select("id, name, admission_no")
    .eq("class_id", classId);

  if (sErr) {
    sendJson(res, 500, { error: sErr.message });
    return;
  }

  const allStudents = students || [];
  const classSize = allStudents.length;
  const studentIds = allStudents.map((s) => s.id);

  if (!studentIds.length) {
    sendJson(res, 200, { ok: true, classSize: 0, position: 1, subjectBenchmarks: {} });
    return;
  }

  // 2. Fetch results for this class cohort in this term & session
  let query = client
    .from("results")
    .select("student_id, subject_id, total, status, subjects(name)")
    .in("student_id", studentIds)
    .eq("term", term)
    .in("status", ["approved", "published", "submitted"]);

  if (session) {
    query = query.eq("session", session);
  }

  const { data: results, error: rErr } = await query;
  if (rErr) {
    sendJson(res, 500, { error: rErr.message });
    return;
  }

  const allResults = results || [];

  // 3. Compute subject benchmarks (class avg, lowest, highest)
  const bySubject = {};
  allResults.forEach((r) => {
    if (!r.subject_id) return;
    if (!bySubject[r.subject_id]) {
      bySubject[r.subject_id] = { name: r.subjects?.name, scores: [] };
    }
    bySubject[r.subject_id].scores.push(Number(r.total) || 0);
  });

  const subjectBenchmarks = {};
  for (const [subjId, info] of Object.entries(bySubject)) {
    const scores = info.scores;
    if (!scores.length) continue;
    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = +(sum / scores.length).toFixed(1);
    const lowest = Math.min(...scores);
    const highest = Math.max(...scores);
    subjectBenchmarks[subjId] = {
      avg,
      lowest,
      highest,
      count: scores.length,
    };
  }

  // 4. Compute student position in class
  const totalsByStudent = new Map();
  studentIds.forEach((id) => totalsByStudent.set(id, 0));
  allResults.forEach((r) => {
    const t = Number(r.total) || 0;
    totalsByStudent.set(r.student_id, (totalsByStudent.get(r.student_id) || 0) + t);
  });

  const sorted = [...totalsByStudent.entries()].sort((a, b) => b[1] - a[1]);
  let position = 1;
  if (studentId) {
    const myTotal = totalsByStudent.get(studentId) || 0;
    let rank = 1;
    for (const [, total] of sorted) {
      if (total > myTotal) rank += 1;
    }
    position = rank;
  }

  sendJson(res, 200, {
    ok: true,
    classSize,
    position,
    subjectBenchmarks,
  });
}

const termEditOverrides = new Map(); // key: `${session}:${term}` -> boolean

async function isTermEditable(session, term, service, currentTerm) {
  if (term === currentTerm) return true;
  const key = `${session}:${term}`;
  if (termEditOverrides.has(key)) {
    return Boolean(termEditOverrides.get(key));
  }
  if (service) {
    const { data: tRow } = await service
      .from("terms")
      .select("*")
      .eq("session", session)
      .eq("term", term)
      .maybeSingle();
    if (tRow) {
      if (typeof tRow.allow_teacher_edit === "boolean") return tRow.allow_teacher_edit;
      if (tRow.status) return tRow.status === "open";
    }
  }
  return false;
}

async function handleGetTerms(req, res, parsed) {
  const service = getServiceClient();
  const { data: settings } = service
    ? await service.from("app_settings").select("*").limit(1).maybeSingle()
    : { data: null };

  const currentTerm = settings?.current_term || "term1";
  const currentSession = parsed.searchParams.get("session") || settings?.current_session || "2025/2026";

  let termsFromDb = [];
  if (service) {
    const { data: terms } = await service
      .from("terms")
      .select("*")
      .eq("session", currentSession);
    termsFromDb = terms || [];
  }

  const termKeys = [
    { term: "term1", label: "1st Term" },
    { term: "term2", label: "2nd Term" },
    { term: "term3", label: "3rd Term" },
  ];

  const resultTerms = await Promise.all(
    termKeys.map(async ({ term, label }) => {
      const isCurrent = term === currentTerm;
      const canEdit = await isTermEditable(currentSession, term, service, currentTerm);
      return {
        term,
        label,
        is_current: isCurrent,
        allow_edit: canEdit,
        status: isCurrent ? "current" : canEdit ? "unlocked" : "locked",
      };
    })
  );

  sendJson(res, 200, {
    ok: true,
    current_term: currentTerm,
    current_session: currentSession,
    terms: resultTerms,
  });
}

async function handleToggleTermEdit(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const { session, term, allow_edit } = body;
  if (!session || !term) {
    sendJson(res, 400, { error: "session and term are required." });
    return;
  }

  const boolAllow = Boolean(allow_edit);
  const overrideKey = `${session}:${term}`;
  termEditOverrides.set(overrideKey, boolAllow);

  const service = getServiceClient();
  if (service) {
    try {
      await service.from("terms").upsert(
        {
          session,
          term,
          allow_teacher_edit: boolAllow,
          status: boolAllow ? "open" : "closed",
        },
        { onConflict: "session,term" }
      );
    } catch (_) {
      try {
        await service.from("terms").upsert(
          {
            session,
            term,
            status: boolAllow ? "open" : "closed",
          },
          { onConflict: "session,term" }
        );
      } catch (_) {}
    }
  }

  sendJson(res, 200, { ok: true, session, term, allow_edit: boolAllow });
}

async function handleSaveResults(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const records = body.records || (Array.isArray(body) ? body : []);
  if (!records.length) {
    sendJson(res, 400, { error: "No records provided." });
    return;
  }

  const service = getServiceClient();
  if (!service) {
    sendJson(res, 503, { error: "Server service role not configured." });
    return;
  }

  // Check if term being saved is permitted for score editing
  const { data: settings } = await service.from("app_settings").select("current_term, current_session").limit(1).maybeSingle();
  const currentTerm = settings?.current_term || "term1";

  for (const r of records) {
    const rTerm = r.term || currentTerm;
    const rSession = r.session || settings?.current_session || "2025/2026";
    const canEdit = await isTermEditable(rSession, rTerm, service, currentTerm);
    if (!canEdit) {
      sendJson(res, 403, {
        error: `Editing scores for ${rTerm} is locked. Administration permission is required to edit non-current terms.`,
      });
      return;
    }
  }

  try {
    let { data, error } = await service
      .from("results")
      .upsert(records, { onConflict: "student_id,subject_id,term,session" });

    if (error && /submitted_at|return_reason/i.test(error.message || "")) {
      const cleaned = records.map(({ submitted_at, return_reason, ...rest }) => rest);
      ({ data, error } = await service
        .from("results")
        .upsert(cleaned, { onConflict: "student_id,subject_id,term,session" }));
    }

    if (error && /session|score_breakdown/i.test(error.message || "")) {
      const fallback = records.map(({ session, class_id, score_breakdown, submitted_at, return_reason, ...rest }) => rest);
      ({ data, error } = await service
        .from("results")
        .upsert(fallback, { onConflict: "student_id,subject_id,term" }));
    }

    if (error) {
      console.error("Save results DB error:", error);
      sendJson(res, 500, { error: error.message });
      return;
    }

    sendJson(res, 200, { ok: true, count: records.length });
  } catch (err) {
    console.error("handleSaveResults exception:", err);
    sendJson(res, 500, { error: err.message || "Failed to save results." });
  }
}

async function handleBatchPublishResults(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const { snapshots = [], resultIds = [], statusCol = {} } = body;

  const service = getServiceClient();
  if (!service) {
    sendJson(res, 503, { error: "Server service role not configured." });
    return;
  }

  try {
    // 1. Upsert into published_snapshots
    if (snapshots.length > 0) {
      const { error: snapErr } = await service
        .from("published_snapshots")
        .upsert(snapshots, { onConflict: "term,session,student_id,report_type" });
      if (snapErr) {
        console.warn("published_snapshots upsert error:", snapErr);
      }
    }

    // 2. Update status in results table
    if (resultIds.length > 0 && Object.keys(statusCol).length > 0) {
      const { error: resErr } = await service
        .from("results")
        .update(statusCol)
        .in("id", resultIds);
      if (resErr) {
        console.warn("results update error:", resErr);
      }
    }

    sendJson(res, 200, { ok: true, publishedCount: snapshots.length });
  } catch (err) {
    console.error("handleBatchPublishResults exception:", err);
    sendJson(res, 500, { error: err.message || "Failed to publish." });
  }
}

async function handleUnpublishResults(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const { classId, milestone, term, session } = body;
  const service = getServiceClient();
  if (!service) {
    sendJson(res, 503, { error: "Server service role not configured." });
    return;
  }

  try {
    // 1. Delete from published_snapshots
    let q = service
      .from("published_snapshots")
      .delete()
      .eq("class_id", classId)
      .eq("report_type", milestone);
    if (term) q = q.eq("term", term);
    if (session) q = q.eq("session", session);
    await q;

    // 2. Clear status column on results
    const statusCol =
      milestone === "PR1"
        ? { pr1_status: null }
        : milestone === "PR2"
        ? { pr2_status: null }
        : milestone === "PR3"
        ? { pr3_status: null }
        : { tr_status: null };

    const { data: students } = await service.from("students").select("id").eq("class_id", classId);
    if (students && students.length > 0) {
      const sIds = students.map((s) => s.id);
      let rq = service.from("results").update(statusCol).in("student_id", sIds);
      if (term) rq = rq.eq("term", term);
      if (session) rq = rq.eq("session", session);
      await rq;
    }

    sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error("handleUnpublishResults exception:", err);
    sendJson(res, 500, { error: err.message || "Failed to unpublish." });
  }
}

const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, `http://${HOST}:${PORT}`);
    const urlPath = parsed.pathname;

    if (urlPath === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        createAuthUserApi: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      });
      return;
    }

    if (urlPath === "/api/student/class-benchmarks") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }

      handleClassBenchmarks(req, res, parsed).catch((error) => {
        console.error("class-benchmarks error:", error);
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    if (urlPath === "/api/results/save") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }
      handleSaveResults(req, res).catch((err) => {
        console.error("save results endpoint error:", err);
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    if (urlPath === "/api/results/batch-publish") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }
      handleBatchPublishResults(req, res).catch((err) => {
        console.error("batch publish endpoint error:", err);
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    if (urlPath === "/api/results/unpublish") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }
      handleUnpublishResults(req, res).catch((err) => {
        console.error("unpublish endpoint error:", err);
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    if (urlPath === "/api/terms") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }
      handleGetTerms(req, res, parsed).catch((err) => {
        console.error("get terms endpoint error:", err);
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    if (urlPath === "/api/admin/terms/toggle-edit") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }
      handleToggleTermEdit(req, res).catch((err) => {
        console.error("toggle term edit endpoint error:", err);
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    if (urlPath === "/api/paystack-config") {
      sendJson(res, 200, {
        ok: true,
        public_key: process.env.PAYSTACK_PUBLIC_KEY || ""
      });
      return;
    }

    if (urlPath === "/api/verify-paystack-payment") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }

      handleVerifyPaystackPayment(req, res).catch((error) => {
        console.error("verify-paystack-payment error:", error);
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    if (urlPath === "/api/admin/create-auth-user") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }

      handleCreateAuthUser(req, res).catch((error) => {
        console.error("create-auth-user error:", error);
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    if (urlPath === "/api/register-student") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }
      handleRegisterStudent(req, res).catch((error) => {
        console.error("register-student error:", error);
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    // Trailing slash for known app routes
    if (!urlPath.endsWith("/") && routeToFile[`${urlPath}/`]) {
      res.writeHead(301, { Location: `${urlPath}/` });
      res.end();
      return;
    }

    if (urlPath === "/form" || urlPath === "/form/" || urlPath === "/form.html") {
      return sendFile(res, path.join(PUBLIC_ROOT, "form.html"));
    }

    if (urlPath === "/supabase.js") {
      return sendFile(res, path.join(PUBLIC_ROOT, "supabase.js"));
    }

    if (urlPath === "/sw.js" || urlPath === "/manifest.webmanifest") {
      const rootFile = safePathFromBase(PUBLIC_ROOT, urlPath.slice(1));
      if (rootFile) return sendFile(res, rootFile);
    }

    const assetPath = tryServePublicAsset(urlPath);
    if (assetPath) {
      return sendFile(res, assetPath);
    }

    const pageFile = resolvePagePath(urlPath);
    if (pageFile) {
      return sendFile(res, path.join(PUBLIC_ROOT, pageFile));
    }

    // Legacy root-level HTML (redirect to public routes)
    const legacyRedirects = {
      "/index.html": "/",
      "/admin.html": "/admin/",
      "/teacher.html": "/teacher/",
      "/student.html": "/student/",
    };
    if (legacyRedirects[urlPath]) {
      res.writeHead(301, { Location: legacyRedirects[urlPath] });
      res.end();
      return;
    }

    sendNotFound(res);
  });

function startListening(port) {
  server.listen(port, HOST, () => {
    console.log(`Gracemark running at http://${HOST}:${port}`);
    console.log(`App root: public/ (login: ${routeToFile["/"]})`);
    if (SUPABASE_SERVICE_ROLE_KEY) {
      console.log("Admin auth user API: enabled (/api/admin/create-auth-user)");
    } else {
      console.log(
        "Admin auth user API: disabled (set SUPABASE_SERVICE_ROLE_KEY in .env for reliable student/teacher signup)"
      );
    }
  });
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`Port ${PORT} is in use, trying port ${PORT + 1}...`);
    PORT += 1;
    startListening(PORT);
  } else {
    console.error("Server error:", err);
  }
});

startListening(PORT);
