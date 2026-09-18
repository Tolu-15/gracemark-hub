const http = require("http");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const HOST = "127.0.0.1";
/** Avoid 5500 — VS Code Live Server uses that port by default. */
const PORT = 5502;
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

http
  .createServer((req, res) => {
    const parsed = new URL(req.url, `http://${HOST}:${PORT}`);
    const urlPath = parsed.pathname;

    if (urlPath === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        createAuthUserApi: Boolean(SUPABASE_SERVICE_ROLE_KEY),
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
  })
  .listen(PORT, HOST, () => {
    console.log(`Gracemark running at http://${HOST}:${PORT}`);
    console.log(`App root: public/ (login: ${routeToFile["/"]})`);
    if (SUPABASE_SERVICE_ROLE_KEY) {
      console.log("Admin auth user API: enabled (/api/admin/create-auth-user)");
    } else {
      console.log(
        "Admin auth user API: disabled (set SUPABASE_SERVICE_ROLE_KEY in .env for reliable student/teacher signup)"
      );
    }
  });
