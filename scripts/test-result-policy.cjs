// Run against an in-memory PostgreSQL fixture only. Supply the installed path to
// @electric-sql/pglite as argv[2] when it is installed outside this project.
const { PGlite } = require(process.argv[2] || "@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('fixture.uid') $$;
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() = 'admin' $$;
      CREATE FUNCTION public.is_teacher() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() = 'staff' $$;
      CREATE TABLE users(id text, auth_id text);
      CREATE TABLE academic_sessions(id text, name text);
      CREATE TABLE subject_teacher_assignments(teacher_user_id text, academic_session_id text, class_id text, subject_id text, status text);
      CREATE TABLE results(id int, class_id text, subject_id text, session text);
      CREATE TABLE student_subject_optouts(id int);
      INSERT INTO users VALUES ('staff-profile','staff');
      INSERT INTO academic_sessions VALUES ('now-id','now');
      INSERT INTO subject_teacher_assignments VALUES ('staff-profile','now-id','A','math','active');
      INSERT INTO results VALUES (1,'A','math','now'),(2,'B','math','now'),(3,'A','math','old');
      INSERT INTO student_subject_optouts VALUES (1);
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
      CREATE POLICY legacy ON results FOR ALL USING (true) WITH CHECK (true);
      CREATE POLICY legacy ON student_subject_optouts FOR ALL USING (true) WITH CHECK (true);
    `);
    const migration = readFileSync(join(__dirname, "../supabase/042_result_access.sql"), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("SET ROLE anon");
    await assert.rejects(db.query("SELECT * FROM results"), /permission denied/i);
    await db.exec("RESET ROLE; SET ROLE authenticated; SET fixture.uid = 'student'");
    assert.deepEqual((await db.query("SELECT id FROM results")).rows, []);
    await assert.rejects(db.query("UPDATE results SET id=5"), /permission denied/i);
    await db.exec("SET fixture.uid = 'staff'");
    assert.deepEqual((await db.query("SELECT id FROM results")).rows, [{ id: 1 }]);
    assert.deepEqual((await db.query("SELECT id FROM student_subject_optouts")).rows, []);
    await db.exec("SET fixture.uid = 'admin'");
    assert.equal((await db.query("SELECT id FROM results")).rows.length, 3);
    assert.equal((await db.query("SELECT id FROM student_subject_optouts")).rows.length, 1);
    console.log("Result and opt-out access policy passed for anonymous, student, teacher and administrator fixtures.");
    // Replace only this disposable fixture table with a score-entry fixture using the
    // deployed column types and conflict key. This runtime never accepts a database URL.
    await db.exec(`
      RESET ROLE;
      ALTER TABLE results RENAME TO read_fixture;
      CREATE ROLE service_role;
      CREATE TABLE results (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid, class_id uuid,
        subject_id uuid, session text, academic_session_id uuid, term text, teacher_id uuid,
        cw numeric, hw numeric, test numeric, project numeric, exam numeric CHECK (exam <= 70),
        grade text, score_breakdown jsonb, status text, return_reason text,
        pr1_status text DEFAULT 'draft', pr2_status text DEFAULT 'draft',
        pr3_status text DEFAULT 'draft', tr_status text DEFAULT 'draft',
        UNIQUE(student_id,subject_id,term,session)
      );
      GRANT ALL ON results TO service_role;
    `);
    const saveMigration = readFileSync(join(__dirname, "../supabase/043_save_score_sheet.sql"), "utf8");
    await db.exec(saveMigration);
    await db.exec(saveMigration);
    const uuid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
    const first = { class_id: uuid(1), subject_id: uuid(2), student_id: uuid(3), session: "Fixture", term: "term1",
      exam: 0, grade: "F", score_breakdown: { exam: "0" }, status: "draft", teacher_id: uuid(5) };
    const write = (rows, ids = []) => db.query("SELECT save_score_sheet($1::jsonb,$2::uuid[],$3,$4,$5,$6)",
      [JSON.stringify(rows), ids, first.class_id, first.subject_id, first.session, first.term]);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(write([first]), /permission denied/i);
    await db.exec("RESET ROLE; SET ROLE service_role");
    await write([first]);
    const id = (await db.query("SELECT id FROM results")).rows[0].id;
    await assert.rejects(write([{ ...first, student_id: uuid(4), exam: 99 }], [id]), /check constraint/i);
    assert.equal((await db.query("SELECT id FROM results")).rows[0].id, id);
    await write([{ ...first, teacher_id: null, exam: 10 }]);
    assert.equal((await db.query("SELECT teacher_id FROM results")).rows[0].teacher_id, first.teacher_id);
    await db.exec("UPDATE results SET pr1_status = 'published'");
    await assert.rejects(write([], [id]), /protected/i);
    await db.exec("UPDATE results SET pr1_status = 'draft'");
    await write([{ ...first, student_id: uuid(4) }], [id]);
    assert.deepEqual((await db.query("SELECT student_id FROM results")).rows, [{ student_id: uuid(4) }]);
    console.log("Score writes passed role, rollback, attribution and published-deletion checks.");
  } finally {
    await db.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
