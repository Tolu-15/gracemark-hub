const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
globalThis.WebSocket = require("ws");

function loadLocalEnv() {
  const out = {};
  try {
    fs.readFileSync(".env.local", "utf8").split(/\r?\n/).forEach((l) => {
      const i = l.indexOf("=");
      if (i > 0 && !l.trim().startsWith("#")) out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
  } catch {}
  return out;
}

const local = loadLocalEnv();
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL || local.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || local.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const PAGE = 1000;
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const EXCLUDE = new Set(["admin_otp_sessions"]);

const FALLBACK_TABLES = [
  "users", "students", "classes", "subjects", "academic_sessions", "terms",
  "student_enrollments", "student_subject_enrollments", "teacher_assignments",
  "class_teacher_assignments", "subject_teacher_assignments", "attendance",
  "attendance_records", "results", "published_snapshots", "cbt_exams",
  "cbt_submissions", "assessments", "assessment_submissions", "payment_invoices",
  "payment_records", "fee_structures", "portal_access_settings",
];

async function discoverTables() {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spec = await res.json();
    const names = Object.keys(spec.definitions || {});
    if (names.length) return names.filter((n) => !EXCLUDE.has(n)).sort();
  } catch (err) {
    console.warn("Table discovery failed, using fallback list:", err.message);
  }
  return FALLBACK_TABLES;
}

async function exportTable(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (error.code === "42703") {
        // no "id" column: fall back to unordered paging
        return exportUnordered(table);
      }
      throw error;
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function exportUnordered(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function fullBackup() {
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, "backup");
  fs.mkdirSync(backupDir, { recursive: true });

  const tables = await discoverTables();
  console.log(`Backing up ${tables.length} tables into ${backupDir}`);

  const manifest = { created_at: new Date().toISOString(), tables: {} };
  const failures = [];

  for (const t of tables) {
    try {
      const rows = await exportTable(t);
      fs.writeFileSync(path.join(backupDir, `${t}.json`), JSON.stringify(rows, null, 2));
      manifest.tables[t] = rows.length;
      console.log(`Backed up ${t} (${rows.length} rows)`);
    } catch (err) {
      if (MISSING_TABLE_CODES.has(err.code)) {
        console.warn(`Skipping ${t}: table does not exist`);
      } else {
        console.error(`FAILED ${t}: ${err.message || err}`);
        failures.push(t);
      }
    }
  }

  fs.writeFileSync(path.join(backupDir, "_manifest.json"), JSON.stringify(manifest, null, 2));

  if (failures.length || Object.keys(manifest.tables).length === 0) {
    console.error(`Backup incomplete. Failed tables: ${failures.join(", ") || "(none exported)"}`);
    process.exit(1);
  }
  console.log("Backup completed successfully.");
}

fullBackup().catch((err) => {
  console.error(err);
  process.exit(1);
});
