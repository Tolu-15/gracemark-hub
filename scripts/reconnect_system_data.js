const fs = require("fs");
const path = require("path");
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
  console.log("=== STARTING COMPLETE SYSTEM DATA RECONNECTION ===");

  // 1. Get Active Academic Session
  const { data: sessions } = await s.from("academic_sessions").select("*").eq("status", "active");
  const activeSession = sessions?.[0] || { id: "61ca9991-ea78-4c9a-9b70-914b0ccbdb41", name: "2026/2027" };
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

  // 4. Fetch All Auth Users
  const { data: authList, error: authErr } = await s.auth.admin.listUsers();
  if (authErr) throw authErr;
  console.log(`Loaded ${authList.users.length} auth accounts from Supabase Auth.`);

  // 5. Synchronize All Auth Accounts into public.users
  console.log("\n--- Step 1: Syncing Auth Accounts to public.users ---");
  let teacherCount = 0;
  for (const u of authList.users) {
    const email = (u.email || "").toLowerCase();
    let role = u.user_metadata?.role;
    if (!role) {
      if (email.includes("admin") || email.includes("academy") || email.includes("toluwanimi")) {
        role = "admin";
      } else if (email.includes("teacher") || email.includes("sch.ng")) {
        role = "teacher";
      } else {
        role = "student";
      }
    }

    let staffId = u.user_metadata?.staff_id;
    if (!staffId && role === "teacher") {
      const match = email.match(/gmt(\d+)/i);
      if (match) staffId = `GMT${match[1].padStart(3, "0")}`;
    }

    let displayName = u.user_metadata?.display_name;
    if (!displayName) {
      const prefix = email.split("@")[0].replace(/[^a-z0-9]/gi, " ");
      displayName = prefix
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }

    const { error: upErr } = await s.from("users").upsert(
      {
        auth_id: u.id,
        email: u.email,
        display_name: displayName,
        role,
        staff_id: staffId || null,
        status: "active",
      },
      { onConflict: "auth_id" }
    );

    if (upErr) {
      console.warn(`Error syncing user ${u.email}:`, upErr.message);
    } else {
      if (role === "teacher") teacherCount++;
    }

    // Ensure default password is 'gracemark'
    await s.auth.admin.updateUserById(u.id, { password: "gracemark" });
  }
  console.log(`Synced all ${authList.users.length} users into public.users!`);

  // 6. Seed / Reconnect Students into public.students
  console.log("\n--- Step 2: Reconnecting Students ---");
  const studentRoster = [
    { name: "Chinedu David Eze", class: "JSS 1", adm: "GMA202501" },
    { name: "Amina Fatima Bello", class: "JSS 1", adm: "GMA202502" },
    { name: "Oluwaseun Michael Adeyemi", class: "JSS 1", adm: "GMA202503" },
    { name: "Zainab Kelechi Ibrahim", class: "JSS 1", adm: "GMA202504" },
    { name: "Favour Chimamanda Okafor", class: "JSS 1", adm: "GMA202505" },
    { name: "Daniel Toluwani Bakare", class: "JSS 2", adm: "GMA202411" },
    { name: "Halima Sadiq Umar", class: "JSS 2", adm: "GMA202412" },
    { name: "Victor Somtochukwu Nnamdi", class: "JSS 2", adm: "GMA202413" },
    { name: "Blessing Omotola Ajayi", class: "JSS 3", adm: "GMA202321" },
    { name: "Emmanuel Chukwuebuka Obi", class: "JSS 3", adm: "GMA202322" },
    { name: "Godwin Ifeanyi Nwosu", class: "SSS 1 Science", adm: "GMA202301" },
    { name: "Maryam Aliyu Garba", class: "SSS 1 Science", adm: "GMA202302" },
    { name: "Samuel Oluwatobi Adeleke", class: "SSS 2 Science", adm: "GMA202201" },
    { name: "Chidera Stephanie Okeke", class: "SSS 2 Science", adm: "GMA202202" },
    { name: "Ibrahim Olumide Lawal", class: "SSS 2 Arts", adm: "GMA202211" },
    { name: "Grace Chiamaka Peters", class: "SSS 2 Arts", adm: "GMA202212" },
    { name: "Ayomide Temitope Olatunji", class: "SSS 2 Commercial", adm: "GMA202221" },
    { name: "Mustapha Sani Bello", class: "SSS 3 Science", adm: "GMA202101" },
    { name: "Deborah Amarachi Nwankwo", class: "SSS 3 Arts", adm: "GMA202111" },
    { name: "TOLUWANIMI Babalola", class: "JSS 1", adm: "GMA1701" },
  ];

  const studentDbRecords = [];
  for (const sr of studentRoster) {
    const classId = classMap.get(sr.class.toLowerCase());
    if (!classId) {
      console.warn(`Class not found for ${sr.class}`);
      continue;
    }

    // Match with auth users by admission number in email
    const admClean = sr.adm.toLowerCase().replace(/[^a-z0-9]/g, "");
    let matchingAuth = authList.users.find((u) => {
      const uEmail = (u.email || "").toLowerCase();
      return uEmail.includes(admClean) || u.user_metadata?.admission_no === sr.adm;
    });

    let authId = matchingAuth ? matchingAuth.id : null;
    if (!authId) {
      const studentEmail = `${admClean}@student.gracemark.edu.ng`;
      try {
        const { data: newAuth, error: cErr } = await s.auth.admin.createUser({
          email: studentEmail,
          password: "gracemark",
          email_confirm: true,
          user_metadata: {
            display_name: sr.name,
            role: "student",
            admission_no: sr.adm,
          },
        });
        if (newAuth?.user) {
          authId = newAuth.user.id;
          await s.from("users").upsert({
            auth_id: authId,
            email: studentEmail,
            display_name: sr.name,
            role: "student",
            status: "active",
          });
        }
      } catch (err) {
        console.warn(`Auth creation error for ${studentEmail}:`, err.message);
      }
    }

    // Check if student exists by admission_no
    const { data: existingStudent } = await s
      .from("students")
      .select("id")
      .eq("admission_no", sr.adm)
      .maybeSingle();

    let studentId;
    if (existingStudent) {
      studentId = existingStudent.id;
      await s
        .from("students")
        .update({
          name: sr.name,
          class_id: classId,
          user_id: authId,
          portal_access_status: "ACTIVE",
        })
        .eq("id", studentId);
    } else {
      const { data: inserted, error: inErr } = await s
        .from("students")
        .insert({
          name: sr.name,
          admission_no: sr.adm,
          class_id: classId,
          user_id: authId,
          portal_access_status: "ACTIVE",
        })
        .select("id")
        .single();

      if (inErr) {
        console.error(`Failed to insert student ${sr.name}:`, inErr.message);
        continue;
      }
      studentId = inserted.id;
    }

    studentDbRecords.push({
      id: studentId,
      name: sr.name,
      adm: sr.adm,
      classId,
      className: sr.class,
    });
  }
  console.log(`Successfully reconnected ${studentDbRecords.length} students into public.students.`);

  // 7. Auto-Enroll Students into Active Session (public.student_enrollments)
  console.log("\n--- Step 3: Enrolling Students into Active Session ---");
  for (const st of studentDbRecords) {
    const { error: seErr } = await s.from("student_enrollments").upsert(
      {
        student_id: st.id,
        class_id: st.classId,
        academic_session_id: activeSession.id,
        session: activeSession.name,
        status: "active",
      },
      { onConflict: "student_id,academic_session_id" }
    );
    if (seErr) console.warn("student_enrollments error:", seErr.message);
  }
  console.log(`Enrolled ${studentDbRecords.length} students into session ${activeSession.name}.`);

  // 8. Auto-Enroll Students into Official Subject Curriculum (public.student_subject_enrollments)
  console.log("\n--- Step 4: Enrolling Students into Official Subjects ---");
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
        student_id: st.id,
        subject_id: subId,
        academic_session_id: activeSession.id,
        session: activeSession.name,
        class_id: st.classId,
        status: "enrolled",
        is_active: true,
      });
    }
  }

  // Clear existing and batch insert
  await s.from("student_subject_enrollments").delete().eq("academic_session_id", activeSession.id);
  const { error: insBatchErr } = await s.from("student_subject_enrollments").insert(allSubjectEnrollments);
  if (insBatchErr) {
    console.error("Batch insert error for student_subject_enrollments:", insBatchErr);
  } else {
    console.log(`Created ${allSubjectEnrollments.length} subject enrollments in public.student_subject_enrollments.`);
  }

  // 9. Assign Demo Teachers to Classes and Subjects
  console.log("\n--- Step 5: Assigning Demo Teachers ---");
  const { data: teacherUsers } = await s
    .from("users")
    .select("auth_id, email, staff_id, display_name")
    .eq("role", "teacher")
    .order("staff_id");

  console.log(`Found ${teacherUsers?.length || 0} teachers in users table.`);
  const gmt001 = teacherUsers?.find((t) => /gmt001/i.test(t.email));
  const gmt002 = teacherUsers?.find((t) => /gmt002/i.test(t.email));
  const gmt003 = teacherUsers?.find((t) => /gmt003/i.test(t.email));

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
      teacher_user_id: gmt001.auth_id,
      class_id: jss1Id,
      academic_session_id: activeSession.id,
      session: activeSession.name,
      status: "active",
    });
    await s.from("classes").update({ class_teacher_id: gmt001.auth_id }).eq("id", jss1Id);
  }

  if (gmt002 && jss2Id) {
    ctaInserts.push({
      teacher_user_id: gmt002.auth_id,
      class_id: jss2Id,
      academic_session_id: activeSession.id,
      session: activeSession.name,
      status: "active",
    });
    await s.from("classes").update({ class_teacher_id: gmt002.auth_id }).eq("id", jss2Id);
  }

  if (gmt003 && sss1SciId) {
    ctaInserts.push({
      teacher_user_id: gmt003.auth_id,
      class_id: sss1SciId,
      academic_session_id: activeSession.id,
      session: activeSession.name,
      status: "active",
    });
    await s.from("classes").update({ class_teacher_id: gmt003.auth_id }).eq("id", sss1SciId);
  }

  if (ctaInserts.length > 0) {
    await s.from("class_teacher_assignments").insert(ctaInserts);
    console.log(`Assigned ${ctaInserts.length} class teachers.`);
  }

  // B. Subject Teacher Assignments (Both legacy and new table)
  const staInserts = [];
  const legacyStaInserts = [];

  function queueSubjectAssign(teacherId, classId, subjectName) {
    const subId = subjectMap.get(subjectName.toLowerCase());
    if (!subId || !classId || !teacherId) return;

    legacyStaInserts.push({
      teacher_user_id: teacherId,
      class_id: classId,
      subject_id: subId,
    });

    staInserts.push({
      teacher_user_id: teacherId,
      class_id: classId,
      subject_id: subId,
      academic_session_id: activeSession.id,
      session: activeSession.name,
      status: "active",
    });
  }

  if (gmt001 && jss1Id) {
    queueSubjectAssign(gmt001.auth_id, jss1Id, "English Language");
    queueSubjectAssign(gmt001.auth_id, jss1Id, "Mathematics");
    queueSubjectAssign(gmt001.auth_id, jss1Id, "History");
  }

  if (gmt002 && jss2Id) {
    queueSubjectAssign(gmt002.auth_id, jss2Id, "Business Studies");
    queueSubjectAssign(gmt002.auth_id, jss2Id, "Digital Technology");
    queueSubjectAssign(gmt002.auth_id, jss2Id, "Intermediate Science");
  }

  if (gmt003 && sss1SciId) {
    queueSubjectAssign(gmt003.auth_id, sss1SciId, "Chemistry");
    queueSubjectAssign(gmt003.auth_id, sss1SciId, "Physics");
    queueSubjectAssign(gmt003.auth_id, sss1SciId, "Biology");
  }

  if (staInserts.length > 0) {
    await s.from("subject_teacher_assignments").insert(staInserts);
    console.log(`Assigned ${staInserts.length} subject teachers.`);
  }

  // Delete legacy and re-insert
  for (const item of legacyStaInserts) {
    await s.from("teacher_assignments").delete().eq("teacher_user_id", item.teacher_user_id).eq("class_id", item.class_id).eq("subject_id", item.subject_id);
  }
  if (legacyStaInserts.length > 0) {
    await s.from("teacher_assignments").insert(legacyStaInserts);
  }

  console.log("Teacher assignments and class teacher delegations successfully configured!");
  console.log("\n=== ALL SYSTEM CONNECTIONS RESTORED SUCCESSFULLY ===");
}

main().catch((err) => {
  console.error("FATAL SCRIPT ERROR:", err);
  process.exit(1);
});
