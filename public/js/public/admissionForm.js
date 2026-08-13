import { supabase } from "/js/shared/supabaseClient.js";
import { ensureClassByName } from "/js/shared/schoolContext.js";

// Step Elements
const steps = [
    document.getElementById("step1"),
    document.getElementById("step2"),
    document.getElementById("step3"),
    document.getElementById("step4"),
    document.getElementById("step5")
];

const tabs = [
    document.getElementById("tabStep1"),
    document.getElementById("tabStep2"),
    document.getElementById("tabStep3"),
    document.getElementById("tabStep4"),
    document.getElementById("tabStep5")
];

const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");
const btnSubmit = document.getElementById("btnSubmit");
const progressBar = document.getElementById("progressBar");
const stepIndicatorLabel = document.getElementById("stepIndicatorLabel");

const admissionForm = document.getElementById("admissionForm");
const isBoardingCheckbox = document.getElementById("is_boarding");
const boardingTypeContainer = document.getElementById("boardingTypeContainer");

let currentStepIndex = 0;

// Boarding toggle handler
isBoardingCheckbox.addEventListener("change", (e) => {
    if (e.target.checked) {
        boardingTypeContainer.classList.remove("hidden");
    } else {
        boardingTypeContainer.classList.add("hidden");
    }
});

// Update Step Views
function renderStep(index) {
    steps.forEach((step, idx) => {
        if (idx === index) {
            step.classList.remove("hidden");
        } else {
            step.classList.add("hidden");
        }
    });

    // Update tab indicators
    tabs.forEach((tab, idx) => {
        if (idx === index) {
            tab.className = "text-indigo-400 font-bold";
        } else if (idx < index) {
            tab.className = "text-emerald-400 font-semibold";
        } else {
            tab.className = "";
        }
    });

    // Progress bar percent
    const pct = ((index + 1) / steps.length) * 100;
    progressBar.style.width = `${pct}%`;

    // Step Title
    const stepTitles = [
        "Student Personal Details",
        "Previous Educational Background",
        "Parent / Guardian Details",
        "Accommodation & Medical Requirements",
        "Application Review & Payment Checkout"
    ];
    stepIndicatorLabel.innerHTML = `<span>STEP ${index + 1} OF 5</span><span class="text-indigo-400">${stepTitles[index]}</span>`;

    // Button States
    btnPrev.classList.toggle("hidden", index === 0);
    btnNext.classList.toggle("hidden", index === steps.length - 1);
    btnSubmit.classList.toggle("hidden", index !== steps.length - 1);

    if (index === steps.length - 1) {
        // Update summary text
        const sName = `${document.getElementById("surname").value.trim()} ${document.getElementById("first_names").value.trim()}`;
        const sClass = document.getElementById("desired_class").value;
        document.getElementById("summaryName").textContent = sName || "Candidate Name";
        document.getElementById("summaryClass").textContent = sClass || "Selected Class";
    }
}

// Validate current step fields
function validateCurrentStep() {
    const currentStepEl = steps[currentStepIndex];
    const inputs = currentStepEl.querySelectorAll("input[required], select[required]");
    let valid = true;

    inputs.forEach((input) => {
        if (!input.value.trim()) {
            input.classList.add("border-rose-500");
            valid = false;
        } else {
            input.classList.remove("border-rose-500");
        }
    });

    if (!valid) {
        alert("Please fill in all required fields marked with * before continuing.");
    }
    return valid;
}

btnNext.addEventListener("click", () => {
    if (validateCurrentStep()) {
        currentStepIndex++;
        renderStep(currentStepIndex);
    }
});

btnPrev.addEventListener("click", () => {
    currentStepIndex--;
    renderStep(currentStepIndex);
});

// Form Submission & Payment Trigger
admissionForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!validateCurrentStep()) return;

    btnSubmit.disabled = true;
    btnSubmit.textContent = "Processing Application...";

    try {
        const surname = document.getElementById("surname").value.trim();
        const first_names = document.getElementById("first_names").value.trim();
        const date_of_birth = document.getElementById("date_of_birth").value;
        const gender = document.getElementById("gender").value;
        const desired_class = document.getElementById("desired_class").value;
        const state_of_origin = document.getElementById("state_of_origin").value.trim();
        const home_address = document.getElementById("home_address").value.trim();
        const student_password = document.getElementById("student_password")?.value?.trim() || "";
        const passport_photo_url = document.getElementById("passport_photo_url").value.trim();

        const previous_school_name = document.getElementById("previous_school_name").value.trim();
        const previous_school_address = document.getElementById("previous_school_address").value.trim();
        const previous_class = document.getElementById("previous_class").value.trim();

        const parent_guardian_name = document.getElementById("parent_guardian_name").value.trim();
        const parent_guardian_email = document.getElementById("parent_guardian_email").value.trim();
        const parent_guardian_phone = document.getElementById("parent_guardian_phone").value.trim();
        const parent_guardian_occupation = document.getElementById("parent_guardian_occupation").value.trim();

        const is_boarding = isBoardingCheckbox.checked;
        const boarding_type = is_boarding ? document.getElementById("boarding_type").value : null;
        const medical_conditions = document.getElementById("medical_conditions").value.trim();

        // 1. Generate unique admission reference
        const admission_number = `ADM-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const admissionPayload = {
            admission_number,
            surname,
            first_names,
            date_of_birth,
            gender,
            desired_class,
            state_of_origin,
            home_address,
            passport_photo_url,
            previous_school_name,
            previous_school_address,
            previous_class,
            parent_guardian_name,
            parent_guardian_email,
            parent_guardian_phone,
            parent_guardian_occupation,
            is_boarding,
            boarding_type,
            medical_conditions,
            application_status: "submitted"
        };

        // 2. Insert into Supabase `admissions` table
        const { data, error } = await supabase
            .from("admissions")
            .insert([admissionPayload])
            .select()
            .single();

        if (error) throw error;

        // 3. Initiate Paystack Payment Checkout
        let paystackKey = null;
        try {
            const cfgRes = await fetch("/api/paystack-config");
            const cfgData = await cfgRes.json().catch(() => ({}));
            paystackKey = cfgData?.public_key || null;
        } catch (_) {}

        if (!paystackKey) {
            paystackKey = window.PAYSTACK_PUBLIC_KEY || "pk_test_b867c4273574971c66708b5e9f8350bbbf4c2c01";
        }

        const fullName = `${surname} ${first_names}`;
        const finalPassword = student_password || "gracemark";
        const userEmail = parent_guardian_email || `${admission_number.replace(/-/g, "").toLowerCase()}@student.gracemark.edu.ng`;
        const APPLICATION_FEE = 10000;
        const uniqueRef = `ADM-${admission_number}-${Date.now()}`;

        const processAccountCreation = async () => {
            try {
                const cls = await ensureClassByName(desired_class);

                let userId = null;
                try {
                    const regRes = await fetch("/api/register-student", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email: userEmail,
                            password: finalPassword,
                            display_name: fullName
                        })
                    });
                    const regData = await regRes.json().catch(() => ({}));
                    if (regData?.user?.id) {
                        userId = regData.user.id;
                    }
                } catch (apiErr) {
                    console.warn("Server API register fallback:", apiErr.message);
                }

                if (!userId) {
                    const { data: authData, error: authErr } = await supabase.auth.signUp({
                        email: userEmail,
                        password: finalPassword,
                        options: { data: { display_name: fullName, role: "student" } }
                    });
                    if (authErr) console.warn("Fallback signUp note:", authErr.message);
                    userId = authData?.user?.id;
                }

                if (userId) {
                    await supabase.from("users").upsert(
                        { auth_id: userId, role: "student", display_name: fullName, email: userEmail },
                        { onConflict: "auth_id" }
                    );

                    const { data: newStudent } = await supabase.from("students").insert({
                        class_id: cls.id,
                        user_id: userId,
                        admission_no: admission_number,
                        name: fullName
                    }).select().maybeSingle();

                    if (newStudent?.id) {
                        await supabase.from("admissions").update({ created_student_id: newStudent.id }).eq("id", data.id);
                    }
                }
            } catch (accErr) {
                console.warn("Auto student account creation note:", accErr?.message);
            }
        };

        const showSuccessModal = () => {
            const completionModal = document.getElementById("completionModal");
            const modalAdmNo = document.getElementById("modalAdmNo");
            const modalEmail = document.getElementById("modalEmail");
            const modalPassword = document.getElementById("modalPassword");
            const modalGoToPortalBtn = document.getElementById("modalGoToPortalBtn");

            if (modalAdmNo) modalAdmNo.textContent = admission_number;
            if (modalEmail) modalEmail.textContent = userEmail;
            if (modalPassword) modalPassword.textContent = finalPassword;

            if (modalGoToPortalBtn) {
                modalGoToPortalBtn.onclick = () => {
                    window.location.href = "/";
                };
            }

            if (completionModal) {
                completionModal.classList.remove("hidden");
            } else {
                alert(
                    `🎉 Application & Account Registration Successful!\n\n` +
                    `📋 Admission Ref: ${admission_number}\n` +
                    `👤 Name: ${fullName}\n` +
                    `🔑 LOGIN CREDENTIALS:\n` +
                    `• Email / Admission No: ${admission_number} or ${userEmail}\n` +
                    `• Password: ${finalPassword}\n\n` +
                    `Click OK to proceed to Portal Login.`
                );
                window.location.href = "/";
            }
        };

        if (typeof PaystackPop !== "undefined") {
            try {
                const handler = PaystackPop.setup({
                    key: paystackKey,
                    email: userEmail,
                    amount: APPLICATION_FEE * 100,
                    currency: "NGN",
                    ref: uniqueRef,
                    label: `Admission Fee — ${fullName}`,
                    metadata: {
                        admission_id: data.id,
                        admission_number: admission_number,
                        student_name: fullName,
                        desired_class: desired_class
                    },
                    callback: async function (response) {
                        btnSubmit.disabled = true;
                        btnSubmit.textContent = "Creating Account...";
                        try {
                            await supabase.from("admission_payments").insert([{
                                admission_id: data.id,
                                payment_reference: response.reference,
                                amount: APPLICATION_FEE,
                                status: "successful",
                                payment_gateway: "paystack",
                                paid_at: new Date().toISOString()
                            }]);
                            await supabase.from("admissions").update({
                                payment_status: "paid",
                                payment_reference: response.reference
                            }).eq("id", data.id);
                        } catch (recErr) {
                            console.warn("Payment record note:", recErr?.message);
                        }

                        await processAccountCreation();
                        showSuccessModal();
                    },
                    onClose: function () {
                        alert(
                            `⚠️ Payment window closed.\n\n` +
                            `Your application (Ref: ${admission_number}) has been saved.\n` +
                            `Please click "Complete Registration & Pay" to pay via Paystack and activate your student portal account.`
                        );
                    }
                });
                handler.openIframe();
            } catch (pErr) {
                console.error("Paystack checkout error:", pErr);
                await processAccountCreation();
                showSuccessModal();
            }
        } else {
            await processAccountCreation();
            showSuccessModal();
        }
    } catch (err) {
        console.error("Submission Error:", err);
        alert("Failed to submit application: " + err.message);
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Complete Registration & Pay";
    }
});

// Init step 1
renderStep(0);

