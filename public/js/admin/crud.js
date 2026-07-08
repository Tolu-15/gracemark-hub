import { supabase } from "/js/shared/supabaseClient.js";
import { getAppSettings } from "/js/shared/appSettings.js";

export { getAppSettings };

function requireValue(value, label) {
  if (!value) throw new Error(`${label} is required`);
}

export async function createSchool({ name, session }) {
  requireValue(name, "School name");
  requireValue(session, "Session");
  const { data, error } = await supabase.from("schools").insert({ name, session }).select("*").single();
  if (error) throw error;
  return data;
}

export async function createClass({ school_id, name, session }) {
  requireValue(school_id, "school_id");
  requireValue(name, "Class name");
  requireValue(session, "Session");
  const { data, error } = await supabase
    .from("classes")
    .insert({ school_id, name, session })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function createSubject({ name }) {
  requireValue(name, "Subject name");
  const { data, error } = await supabase.from("subjects").insert({ name }).select("*").single();
  if (error) throw error;
  return data;
}

// Note: creating Auth users requires an Edge Function (service role). This only creates the student record.
export async function createStudent({ class_id, user_id, admission_no, name }) {
  requireValue(class_id, "class_id");
  requireValue(user_id, "user_id (auth uid)");
  requireValue(admission_no, "admission_no");
  requireValue(name, "Student name");

  const payload = {
    class_id,
    user_id,
    admission_no: String(admission_no).trim(),
    name: String(name).trim(),
  };

  const { data, error } = await supabase.from("students").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

export async function assignTeacherToClassSubject({ teacher_user_id, class_id, subject_id }) {
  requireValue(teacher_user_id, "teacher_user_id (auth uid)");
  requireValue(class_id, "class_id");
  requireValue(subject_id, "subject_id");

  const { data, error } = await supabase
    .from("teacher_assignments")
    .insert({ teacher_user_id, class_id, subject_id })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// One row per student+subject+term (upsert)
export async function upsertResult({
  student_id,
  subject_id,
  term,
  cw = 0,
  hw = 0,
  test = 0,
  project = 0,
  exam = 0,
}) {
  requireValue(student_id, "student_id");
  requireValue(subject_id, "subject_id");
  requireValue(term, "term");

  const payload = { student_id, subject_id, term, cw, hw, test, project, exam };
  const { data, error } = await supabase
    .from("results")
    .upsert(payload, { onConflict: "student_id,subject_id,term" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function upsertAttendance({ student_id, term, days_present = 0, days_absent = 0 }) {
  requireValue(student_id, "student_id");
  requireValue(term, "term");

  const payload = { student_id, term, days_present, days_absent };
  const { data, error } = await supabase
    .from("attendance")
    .upsert(payload, { onConflict: "student_id,term" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setAppSettings({ current_term, current_session }) {
  requireValue(current_term, "current_term");
  const payload = { id: 1, current_term, current_session: current_session ?? "" };
  const { data, error } = await supabase.from("app_settings").upsert(payload).select("*").single();
  if (error) throw error;
  return data;
}

