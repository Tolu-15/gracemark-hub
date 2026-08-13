import { requireRole } from "/js/shared/guard.js";
import { signOut } from "/js/shared/auth.js";
import { supabase } from "/js/shared/supabaseClient.js";

const authLoader = document.getElementById("authLoader");
const logoutBtn = document.getElementById("logoutBtn");

const profileForm = document.getElementById("profileForm");
const profileAlert = document.getElementById("profileAlert");
const saveProfileBtn = document.getElementById("saveProfileBtn");

const avatarPreview = document.getElementById("avatarPreview");
const pStudentName = document.getElementById("pStudentName");
const pAdmNo = document.getElementById("pAdmNo");
const pClass = document.getElementById("pClass");

const pFullName = document.getElementById("pFullName");
const pEmail = document.getElementById("pEmail");
const pState = document.getElementById("pState");
const pAddress = document.getElementById("pAddress");
const pPhotoUrl = document.getElementById("pPhotoUrl");
const pGuardianName = document.getElementById("pGuardianName");
const pGuardianPhone = document.getElementById("pGuardianPhone");
const pGuardianOccupation = document.getElementById("pGuardianOccupation");

let currentAuthId = null;
let currentStudentId = null;
let currentAdmissionId = null;

function showAlert(message, type = "success") {
  profileAlert.textContent = message;
  profileAlert.className = type === "success" 
    ? "p-4 rounded-xl text-sm font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 mb-4"
    : "p-4 rounded-xl text-sm font-semibold bg-red-50 text-red-800 border border-red-200 mb-4";
  profileAlert.classList.remove("hidden");
}

function hideAlert() {
  profileAlert.classList.add("hidden");
}

async function loadProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Authentication required.");

  currentAuthId = user.id;
  pEmail.value = user.email || "";

  // 1. Fetch student record
  let { data: student, error: stErr } = await supabase
    .from("students")
    .select("id, admission_no, name, class_id, classes(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!student) {
    const displayName = user.user_metadata?.display_name || user.email?.split("@")[0] || "Student";
    const admissionNo = "GMA" + Math.floor(100000 + Math.random() * 900000);
    let { data: defaultClass } = await supabase.from("classes").select("id").limit(1).maybeSingle();

    if (!defaultClass) {
      const { data: school } = await supabase.from("schools").select("id").limit(1).maybeSingle();
      if (school?.id) {
        const { data: createdClass } = await supabase
          .from("classes")
          .insert([{ name: "General Admission", school_id: school.id, session: "2026/2027" }])
          .select("id")
          .maybeSingle();
        defaultClass = createdClass;
      }
    }

    if (defaultClass?.id) {
      const { data: newStudent } = await supabase
        .from("students")
        .upsert(
          [
            {
              user_id: user.id,
              class_id: defaultClass.id,
              admission_no: admissionNo,
              name: displayName,
            },
          ],
          { onConflict: "user_id" }
        )
        .select("id, admission_no, name, class_id, classes(name)")
        .maybeSingle();

      student = newStudent;
    }
  }
    currentStudentId = student.id;
    pStudentName.textContent = student.name || "Student";
    pFullName.value = student.name || "";
    pAdmNo.textContent = student.admission_no || "—";
    pClass.textContent = student.classes?.name || "Unassigned";

    if (student.name) {
      avatarPreview.textContent = student.name.charAt(0).toUpperCase();
    }

    // 2. Fetch linked admission details if available
    const { data: admission } = await supabase
      .from("admissions")
      .select("*")
      .or(`admission_number.eq.${student.admission_no},created_student_id.eq.${student.id}`)
      .limit(1)
      .maybeSingle();

    if (admission) {
      currentAdmissionId = admission.id;
      pState.value = admission.state_of_origin || "";
      pAddress.value = admission.home_address || "";
      pPhotoUrl.value = admission.passport_photo_url || "";
      pGuardianName.value = admission.parent_guardian_name || "";
      pGuardianPhone.value = admission.parent_guardian_phone || "";
      pGuardianOccupation.value = admission.parent_guardian_occupation || "";

      if (admission.passport_photo_url) {
        avatarPreview.innerHTML = `<img src="${admission.passport_photo_url}" alt="Photo" class="w-full h-full object-cover" />`;
      }
    }
  }
}

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();
  saveProfileBtn.disabled = true;
  saveProfileBtn.textContent = "Saving Changes...";

  try {
    const fullName = pFullName.value.trim();
    const state = pState.value.trim();
    const address = pAddress.value.trim();
    const photoUrl = pPhotoUrl.value.trim();
    const gName = pGuardianName.value.trim();
    const gPhone = pGuardianPhone.value.trim();
    const gOccupation = pGuardianOccupation.value.trim();

    if (!fullName) throw new Error("Full name is required.");

    // Update students table
    if (currentStudentId) {
      const { error: stErr } = await supabase
        .from("students")
        .update({ name: fullName })
        .eq("id", currentStudentId);
      if (stErr) throw stErr;
    }

    // Update users profile table
    if (currentAuthId) {
      await supabase
        .from("users")
        .update({ display_name: fullName })
        .eq("auth_id", currentAuthId);
    }

    // Update admissions record if present
    if (currentAdmissionId) {
      await supabase
        .from("admissions")
        .update({
          state_of_origin: state,
          home_address: address,
          passport_photo_url: photoUrl,
          parent_guardian_name: gName,
          parent_guardian_phone: gPhone,
          parent_guardian_occupation: gOccupation,
        })
        .eq("id", currentAdmissionId);
    }

    pStudentName.textContent = fullName;
    if (photoUrl) {
      avatarPreview.innerHTML = `<img src="${photoUrl}" alt="Photo" class="w-full h-full object-cover" />`;
    } else {
      avatarPreview.textContent = fullName.charAt(0).toUpperCase();
    }

    showAlert("Profile changes saved successfully!", "success");
  } catch (err) {
    showAlert(err.message || "Failed to save profile.", "error");
  } finally {
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = "Save Profile Changes";
  }
});

logoutBtn?.addEventListener("click", async () => {
  await signOut();
  window.location.replace("/");
});

async function init() {
  try {
    const ok = await requireRole("student", { redirectTo: "/" });
    if (!ok) return;

    await loadProfile();
    authLoader.style.display = "none";
  } catch (err) {
    console.error("Profile init error:", err);
    authLoader.innerHTML = `<p class="text-sm text-red-500 font-medium text-center p-4">Failed to load profile: ${err.message}</p>`;
  }
}

init();
