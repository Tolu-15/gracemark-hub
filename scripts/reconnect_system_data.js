const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
globalThis.WebSocket = require("ws");

// 1. Read .env.local
const envFile = fs.readFileSync(".env.local", "utf8");
let url, key;
envFile.split("\n").forEach((line) => {
  if (line.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) url = line.split("=")[1].trim();
  if (line.startsWith("SUPABASE_SERVICE_ROLE_KEY=")) key = line.split("=")[1].trim();
});

if (!url || !key) {
  console.error("Missing SUPABASE credentials in .env.local");
  process.exit(1);
}

const s = createClient(url, key);

async function main() {
  console.log("=== STARTING COMPLETE CANONICAL SYSTEM DATA RECONNECTION ===");

  // 1. Get Active Academic Session
  const { data: sessions } = await s.from("academic_sessions").select("*").eq("status", "active");
  const activeSession = sessions?.[0] || { id: "ed0186f6-5552-4948-b086-fe818c485a04", name: "2026/2027" };
  console.log("Active Session:", activeSession.name, "(ID:", activeSession.id, ")");

  // 2. Get All Classes
  const { data: classes } = await s.from("classes").select("id, name");
  const classMap = new Map();
  (classes || []).forEach((c) => classMap.set(c.name.trim().toLowerCase(), c.id));
  console.log(`Loaded ${classes?.length || 0} classes.`);

  // 3. Get All Official Subjects
  const { data: subjects } = await s.from("subjects").select("id, name");
  const subjectMap = new Map();
  (subjects || []).forEach((sub) => subjectMap.set(sub.name.trim().toLowerCase(), sub.id));
  console.log(`Loaded ${subjects?.length || 0} subjects.`);

  // 4. Fetch All Users from public.users
  const { data: allUsers, error: userErr } = await s.from("users").select("id, auth_id, email, role, display_name, staff_id");
  if (userErr) throw userErr;
  console.log(`Loaded ${allUsers.length} users from public.users.`);

  // 5. Reconnect Students into public.students
  console.log("\n--- Step 1: Reconnecting Students into public.students ---");
  const studentRoster = [
    { name: "Chinedu David Eze", class: "JSS 1", adm: "GMA202501", gender: "male" },
    { name: "Amina Fatima Bello", class: "JSS 1", adm: "GMA202502", gender: "female" },
    { name: "Oluwaseun Michael Adeyemi", class: "JSS 1", adm: "GMA202503", gender: "male" },
    { name: "Zainab Kelechi Ibrahim", class: "JSS 1", adm: "GMA202504", gender: "female" },
    { name: "Favour Chimamanda Okafor", class: "JSS 1", adm: "GMA202505", gender: "female" },
    { name: "Daniel Toluwani Bakare", class: "JSS 2", adm: "GMA202411", gender: "male" },
    { name: "Halima Sadiq Umar", class: "JSS 2", adm: "GMA202412", gender: "female" },
    { name: "Victor Somtochukwu Nnamdi", class: "JSS 2", adm: "GMA202413", gender: "male" },
    { name: "Blessing Omotola Ajayi", class: "JSS 3", adm: "GMA202321", gender: "female" },
    { name: "Emmanuel Chukwuebuka Obi", class: "JSS 3", adm: "GMA202322", gender: "male" },
    { name: "Godwin Ifeanyi Nwosu", class: "SSS 1 Science", adm: "GMA202301", gender: "male" },
    { name: "Maryam Aliyu Garba", class: "SSS 1 Science", adm: "GMA202302", gender: "female" },
    { name: "Samuel Oluwatobi Adeleke", class: "SSS 2 Science", adm: "GMA202201", gender: "male" },
    { name: "Chidera Stephanie Okeke", class: "SSS 2 Science", adm: "GMA202202", gender: "female" },
    { name: "Ibrahim Olumide Lawal", class: "SSS 2 Arts", adm: "GMA202211", gender: "male" },
    { name: "Grace Chiamaka Peters", class: "SSS 2 Arts", adm: "GMA202212", gender: "female" },
    { name: "Ayomide Temitope Olatunji", class: "SSS 2 Commercial", adm: "GMA202221", gender: "female" },
    { name: "Mustapha Sani Bello", class: "SSS 3 Science", adm: "GMA202101", gender: "male" },
    { name: "Deborah Amarachi Nwankwo", class: "SSS 3 Arts", adm: "GMA202111", gender: "female" },
    { name: "TOLUWANIMI Babalola", class: "JSS 1", adm: "GMA1701", gender: "male" },
  ];

  const studentDbRecords = [];
  for (const sr of studentRoster) {
    const classId = classMap.get(sr.class.toLowerCase());
    if (!classId) {
      console.warn(`Class not found for ${sr.class}`);
      continue;
    }

    const admClean = sr.adm.toLowerCase().replace(/[^a-z0-9]/g, "");
    const matchingUser = allUsers.find((u) => {
      const email = (u.email || "").toLowerCase();
      return email.includes(admClean);
    });

    if (!matchingUser) {
      console.warn(`User account not found for student ${sr.adm}`);
      continue;
    }

    // Upsert student into public.students
    const { data: upsertedStudent, error: sErr } = await s
      .from("students")
      .upsert(
        {
          user_id: matchingUser.id,
          admission_no: sr.adm,
          full_name: sr.name,
          gender: sr.gender,
          current_class_id: classId,
          portal_access_status: "active",
        },
        { onConflict: "admission_no" }
      )
      .select("id")
      .single();

    if (sErr) {
      console.error(`Error saving student ${sr.name}:`, sErr.message);
      continue;
    }

    studentDbRecords.push({
      id: upsertedStudent.id,
      name: sr.name,
      adm: sr.adm,
      classId,
      className: sr.class,
    });
  }

  console.log(`Successfully reconnected ${studentDbRecords.length} students into public.students.`);

  // 6. Auto-Enroll Students into Active Session (public.student_enrollments)
  console.log("\n--- Step 2: Enrolling Students into Active Session ---");
  const enrollmentMap = new Map(); // student_id -> enrollment_id
  for (const st of studentDbRecords) {
    const { data: enRow, error: seErr } = await s
      .from("student_enrollments")
      .upsert(
        {
          student_id: st.id,
          class_id: st.classId,
          academic_session_id: activeSession.id,
          status: "active",
        },
        { onConflict: "student_id,academic_session_id" }
      )
      .select("id")
      .single();

    if (seErr) {
      console.warn(`student_enrollments error for ${st.name}:`, seErr.message);
    } else if (enRow) {
      enrollmentMap.set(st.id, enRow.id);
    }
  }
  console.log(`Enrolled ${enrollmentMap.size} students into session ${activeSession.name}.`);

  // 7. Auto-Enroll Students into Official Subject Curriculum (public.student_subject_enrollments)
  console.log("\n--- Step 3: Enrolling Students into Official Subjects ---");
  const jssSubjects = [
    "Business Studies",
    "Christian Religious Studies",
    "Cultural and Creative Art",
    "Digital Technology",
    "English Language",
    "History",
    "Intermediate Science",
    "Mathematics",
    "Physical and Health Education",
    "Social and Citizenship Studies",
    "Trade",
    "Yoruba",
  ];

  const sssCore = ["Mathematics", "English", "Economics", "Citizenship", "Trade", "Digital Technology"];
  const sssScience = [...sssCore, "Chemistry", "Physics", "Biology", "Agric"];
  const sssArts = [...sssCore, "Literature", "Government", "CRS", "Yoruba"];
  const sssCommercial = [...sssCore, "Account", "Commerce", "Marketing"];

  const allSubjectEnrollments = [];
  for (const st of studentDbRecords) {
    const enrollmentId = enrollmentMap.get(st.id);
    if (!enrollmentId) continue;

    const isJss = /JSS/i.test(st.className);
    let targetSubjects = [];
    if (isJss) {
      targetSubjects = jssSubjects;
    } else if (/Sci/i.test(st.className)) {
      targetSubjects = sssScience;
    } else if (/Art/i.test(st.className)) {
      targetSubjects = sssArts;
    } else if (/Comm/i.test(st.className)) {
      targetSubjects = sssCommercial;
    } else {
      targetSubjects = sssScience;
    }

    for (const subName of targetSubjects) {
      const subId = subjectMap.get(subName.toLowerCase());
      if (!subId) continue;
      allSubjectEnrollments.push({
        enrollment_id: enrollmentId,
        subject_id: subId,
        status: "enrolled",
      });
    }
  }

  // Clear existing enrollments for these enrollment IDs and insert
  const enrollmentIds = Array.from(enrollmentMap.values());
  for (const eid of enrollmentIds) {
    await s.from("student_subject_enrollments").delete().eq("enrollment_id", eid);
  }

  const { data: insSSE, error: insBatchErr } = await s
    .from("student_subject_enrollments")
    .insert(allSubjectEnrollments)
    .select("id");

  if (insBatchErr) {
    console.error("Batch insert error for student_subject_enrollments:", insBatchErr);
  } else {
    console.log(`Created ${insSSE?.length || allSubjectEnrollments.length} subject enrollments in public.student_subject_enrollments.`);
  }

  // 8. Assign Demo Teachers to Classes and Subjects
  console.log("\n--- Step 4: Assigning Demo Teachers ---");
  const teacherUsers = allUsers.filter((u) => u.role === "teacher");
  console.log(`Found ${teacherUsers.length} teachers in users table.`);

  const gmt001 = teacherUsers.find((t) => t.staff_id === "GMT001");
  const gmt002 = teacherUsers.find((t) => t.staff_id === "GMT002");
  const gmt003 = teacherUsers.find((t) => t.staff_id === "GMT003");

  const jss1Id = classMap.get("jss 1");
  const jss2Id = classMap.get("jss 2");
  const sss1SciId = classMap.get("sss 1 science");

  // Clean old active assignments for this session
  await s.from("class_teacher_assignments").delete().eq("academic_session_id", activeSession.id);
  await s.from("subject_teacher_assignments").delete().eq("academic_session_id", activeSession.id);

  // A. Class Teacher Assignments
  const ctaInserts = [];
  if (gmt001 && jss1Id) {
    ctaInserts.push({
      teacher_user_id: gmt001.id,
      class_id: jss1Id,
      academic_session_id: activeSession.id,
      status: "active",
    });
  }

  if (gmt002 && jss2Id) {
    ctaInserts.push({
      teacher_user_id: gmt002.id,
      class_id: jss2Id,
      academic_session_id: activeSession.id,
      status: "active",
    });
  }

  if (gmt003 && sss1SciId) {
    ctaInserts.push({
      teacher_user_id: gmt003.id,
      class_id: sss1SciId,
      academic_session_id: activeSession.id,
      status: "active",
    });
  }

  if (ctaInserts.length > 0) {
    const { error: ctaErr } = await s.from("class_teacher_assignments").insert(ctaInserts);
    if (ctaErr) console.error("class_teacher_assignments error:", ctaErr);
    else console.log(`Assigned ${ctaInserts.length} class teachers.`);
  }

  // B. Subject Teacher Assignments
  const staInserts = [];
  function queueSubjectAssign(teacherId, classId, subjectName) {
    const subId = subjectMap.get(subjectName.toLowerCase());
    if (!subId || !classId || !teacherId) return;

    staInserts.push({
      teacher_user_id: teacherId,
      class_id: classId,
      subject_id: subId,
      academic_session_id: activeSession.id,
      status: "active",
    });
  }

  if (gmt001 && jss1Id) {
    queueSubjectAssign(gmt001.id, jss1Id, "English Language");
    queueSubjectAssign(gmt001.id, jss1Id, "Mathematics");
    queueSubjectAssign(gmt001.id, jss1Id, "History");
  }

  if (gmt002 && jss2Id) {
    queueSubjectAssign(gmt002.id, jss2Id, "Business Studies");
    queueSubjectAssign(gmt002.id, jss2Id, "Digital Technology");
    queueSubjectAssign(gmt002.id, jss2Id, "Intermediate Science");
  }

  if (gmt003 && sss1SciId) {
    queueSubjectAssign(gmt003.id, sss1SciId, "Chemistry");
    queueSubjectAssign(gmt003.id, sss1SciId, "Physics");
    queueSubjectAssign(gmt003.id, sss1SciId, "Biology");
  }

  if (staInserts.length > 0) {
    const { error: staErr } = await s.from("subject_teacher_assignments").insert(staInserts);
    if (staErr) console.error("subject_teacher_assignments error:", staErr);
    else console.log(`Assigned ${staInserts.length} subject teachers.`);
  }

  console.log("\nTeacher assignments and class teacher delegations successfully configured!");
  console.log("=== ALL SYSTEM CONNECTIONS RESTORED SUCCESSFULLY ===");
}

main().catch((err) => {
  console.error("FATAL SCRIPT ERROR:", err);
  process.exit(1);
});
