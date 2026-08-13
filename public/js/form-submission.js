import { supabase } from "/supabase.js";

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const formId = urlParams.get("id");

  const loadingState = document.getElementById("loadingState");
  const errorState = document.getElementById("errorState");
  const publicDynamicForm = document.getElementById("publicDynamicForm");
  const errorStateMsg = document.getElementById("errorStateMsg");

  const formHeaderTitle = document.getElementById("formHeaderTitle");
  const formHeaderSubtitle = document.getElementById("formHeaderSubtitle");
  const targetClassSelect = document.getElementById("targetClassSelect");
  const feeBanner = document.getElementById("feeBanner");
  const feeAmountDisplay = document.getElementById("feeAmountDisplay");
  const feeBannerText = document.getElementById("feeBannerText");
  const dynamicFieldsContainer = document.getElementById("dynamicFieldsContainer");

  const formErrorMsg = document.getElementById("formErrorMsg");
  const submitFormBtn = document.getElementById("submitFormBtn");
  const btnSpinner = document.getElementById("btnSpinner");
  const btnText = document.getElementById("btnText");

  let currentForm = null;
  let paystackPublicKey = "";

  if (!formId) {
    showError("No form ID provided in the URL.");
    return;
  }

  // Fetch Paystack Config
  try {
    const res = await fetch("/api/paystack-config");
    const data = await res.json();
    paystackPublicKey = data.public_key || "";
  } catch (err) {
    paystackPublicKey = "";
  }

  // Load Classes for Class Select Dropdown
  let availableClasses = [];
  try {
    const { data: classData } = await supabase.from("classes").select("id, name").order("name");
    availableClasses = classData || [];
  } catch (e) {
    console.warn("Classes fetch error:", e);
  }

  // Load Form from Supabase
  try {
    const { data: formData, error } = await supabase
      .from("custom_forms")
      .select("*, classes(name)")
      .eq("id", formId)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !formData) {
      showError("Form not found or has been deactivated by the admin.");
      return;
    }

    currentForm = formData;
    renderForm(currentForm);
  } catch (err) {
    console.error("Form load error:", err);
    showError("Unable to load form data. Please check your internet connection.");
  }

  function showError(message) {
    loadingState.classList.add("hidden");
    publicDynamicForm.classList.add("hidden");
    errorState.classList.remove("hidden");
    if (errorStateMsg) errorStateMsg.textContent = message;
    if (formHeaderTitle) formHeaderTitle.textContent = "Application Unavailable";
  }

  function renderForm(form) {
    loadingState.classList.add("hidden");
    errorState.classList.add("hidden");
    publicDynamicForm.classList.remove("hidden");

    formHeaderTitle.textContent = form.title || "Student Admission Form";
    formHeaderSubtitle.textContent = form.description || "Fill in your details below to apply.";

    // Render Target Class Dropdown
    targetClassSelect.innerHTML = `<option value="">-- Select Target Admission Class --</option>` +
      availableClasses.map(c => `<option value="${c.id}" ${form.class_id === c.id ? "selected" : ""}>${c.name}</option>`).join("");

    const fee = Number(form.fee_amount || 0);
    if (fee > 0) {
      feeBanner.classList.remove("hidden");
      feeAmountDisplay.textContent = `₦${fee.toLocaleString()}`;
      feeBannerText.textContent = "Application fee payable via Paystack checkout";
      btnText.textContent = `Pay ₦${fee.toLocaleString()} & Complete Registration`;
    } else {
      feeAmountDisplay.textContent = "FREE";
      feeBannerText.textContent = "No application fee required for this form";
      btnText.textContent = "Submit & Register Account";
    }

    // Render Dynamic Form Fields
    dynamicFieldsContainer.innerHTML = "";
    const fields = Array.isArray(form.form_fields) ? form.form_fields : [];

    if (fields.length === 0) {
      dynamicFieldsContainer.innerHTML = `
        <p class="text-xs text-slate-500 italic">No extra custom fields required.</p>
      `;
    } else {
      fields.forEach((field, index) => {
        const fieldWrap = document.createElement("div");
        fieldWrap.className = "flex flex-col gap-1";

        const label = document.createElement("label");
        label.className = "form-label";
        label.textContent = `${field.label || `Field ${index + 1}`} ${field.required ? "*" : ""}`;

        let input;
        if (field.type === "select" && Array.isArray(field.options)) {
          input = document.createElement("select");
          input.className = "form-input";
          input.name = `custom_${index}`;
          if (field.required) input.required = true;

          const defaultOpt = document.createElement("option");
          defaultOpt.value = "";
          defaultOpt.textContent = `-- Select ${field.label} --`;
          input.appendChild(defaultOpt);

          field.options.forEach((opt) => {
            const option = document.createElement("option");
            option.value = opt;
            option.textContent = opt;
            input.appendChild(option);
          });
        } else if (field.type === "textarea") {
          input = document.createElement("textarea");
          input.className = "form-input min-h-[80px]";
          input.name = `custom_${index}`;
          input.placeholder = field.placeholder || "";
          if (field.required) input.required = true;
        } else {
          input = document.createElement("input");
          input.type = field.type || "text";
          input.className = "form-input";
          input.name = `custom_${index}`;
          input.placeholder = field.placeholder || "";
          if (field.required) input.required = true;
        }

        fieldWrap.appendChild(label);
        fieldWrap.appendChild(input);
        dynamicFieldsContainer.appendChild(fieldWrap);
      });
    }
  }

  // Handle Form Submission
  publicDynamicForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    formErrorMsg.classList.add("hidden");

    const name = document.getElementById("applicantName").value.trim();
    const email = document.getElementById("applicantEmail").value.trim().toLowerCase();
    const password = document.getElementById("applicantPassword").value;
    const selectedClassId = targetClassSelect.value || currentForm.class_id;

    const gender = document.getElementById("applicantGender")?.value || "";
    const dob = document.getElementById("applicantDob")?.value || "";
    const guardianName = document.getElementById("guardianName")?.value.trim() || "";
    const guardianPhone = document.getElementById("guardianPhone")?.value.trim() || "";
    const guardianOccupation = document.getElementById("guardianOccupation")?.value.trim() || "";
    const stateOfOrigin = document.getElementById("stateOfOrigin")?.value.trim() || "";
    const homeAddress = document.getElementById("homeAddress")?.value.trim() || "";

    if (!name || !email || !password) {
      showFormError("Please fill in your name, email, and password.");
      return;
    }

    if (!selectedClassId) {
      showFormError("Please select a target admission class.");
      return;
    }

    if (password.length < 6) {
      showFormError("Password must be at least 6 characters.");
      return;
    }

    // Collect custom field values
    const customData = {
      gender,
      dob,
      guardian_name: guardianName,
      guardian_phone: guardianPhone,
      guardian_occupation: guardianOccupation,
      state_of_origin: stateOfOrigin,
      home_address: homeAddress,
    };

    const fields = Array.isArray(currentForm.form_fields) ? currentForm.form_fields : [];
    fields.forEach((field, index) => {
      const el = document.getElementsByName(`custom_${index}`)[0];
      if (el) {
        customData[field.label || `field_${index}`] = el.value.trim();
      }
    });

    const feeAmount = Number(currentForm.fee_amount || 0);

    setSubmitting(true);

    if (feeAmount > 0) {
      // Trigger Paystack Gateway
      triggerPaystackPayment({
        email,
        amountKobo: Math.round(feeAmount * 100),
        name,
        onSuccess: async (response) => {
          await processRegistrationAndSubmission({
            name,
            email,
            password,
            classId: selectedClassId,
            paymentStatus: "paid",
            paymentRef: response.reference || `PAY-${Date.now()}`,
            customData,
          });
        },
        onCancel: () => {
          setSubmitting(false);
          showFormError("Payment was cancelled. You must complete payment to register.");
        },
      });
    } else {
      // Free form submission
      await processRegistrationAndSubmission({
        name,
        email,
        password,
        classId: selectedClassId,
        paymentStatus: "free",
        paymentRef: null,
        customData,
      });
    }
  });

  function triggerPaystackPayment({ email, amountKobo, name, onSuccess, onCancel }) {
    if (typeof PaystackPop === "undefined" || !paystackPublicKey || paystackPublicKey === "pk_test_placeholder_key") {
      console.warn("Paystack key missing/placeholder. Auto-proceeding in Test Mode.");
      setTimeout(() => {
        onSuccess({ reference: `TEST-PAY-${Date.now()}` });
      }, 600);
      return;
    }

    try {
      const handler = PaystackPop.setup({
        key: paystackPublicKey,
        email: email,
        amount: amountKobo,
        currency: "NGN",
        ref: "GM-ADM-" + Math.floor(Math.random() * 1000000000 + 1),
        metadata: {
          custom_fields: [
            { display_name: "Applicant Name", variable_name: "applicant_name", value: name },
            { display_name: "Form ID", variable_name: "form_id", value: formId },
          ],
        },
        callback: function (response) {
          onSuccess(response);
        },
        onClose: function () {
          onCancel();
        },
      });

      handler.openIframe();
    } catch (err) {
      console.warn("Paystack setup error, completing in test mode:", err);
      onSuccess({ reference: `TEST-PAY-${Date.now()}` });
    }
  }

  async function processRegistrationAndSubmission({ name, email, password, classId, paymentStatus, paymentRef, customData }) {
    try {
      let authUserId = null;

      // 1. Try Backend Service API `/api/register-student`
      try {
        const regRes = await fetch("/api/register-student", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            display_name: name,
          }),
        });

        const regResult = await regRes.json();
        if (regRes.ok && regResult.user?.id) {
          authUserId = regResult.user.id;
        }
      } catch (e) {
        console.warn("Backend register-student endpoint unavailable, falling back to client signUp", e);
      }

      // Fallback: Client-side Supabase SignUp if backend API call failed
      if (!authUserId) {
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name, role: "student" }
          }
        });

        if (signUpErr && !signUpData?.user) {
          const { data: loginData } = await supabase.auth.signInWithPassword({ email, password });
          if (loginData?.user) {
            authUserId = loginData.user.id;
          } else {
            throw signUpErr;
          }
        } else {
          authUserId = signUpData.user?.id;
        }
      }

      // 2. Register or fetch Student Record in Supabase
      let studentId = null;
      if (authUserId) {
        const admissionNo = "GMA" + Math.floor(100000 + Math.random() * 900000);

        await supabase.from("users").upsert([
          {
            auth_id: authUserId,
            email: email,
            display_name: name,
            role: "student",
          },
        ]);

        const { data: stdData } = await supabase
          .from("students")
          .upsert(
            [
              {
                user_id: authUserId,
                class_id: classId,
                admission_no: admissionNo,
                name: name,
              },
            ],
            { onConflict: "user_id" }
          )
          .select("id")
          .maybeSingle();

        studentId = stdData?.id || null;
      }

      // 3. Store Form Submission
      await supabase.from("form_submissions").insert([
        {
          form_id: currentForm.id,
          student_id: studentId,
          applicant_name: name,
          applicant_email: email,
          payment_status: paymentStatus,
          payment_ref: paymentRef,
          form_data: customData,
        },
      ]);

      // 4. Auto Login Student with Supabase Auth
      await supabase.auth.signInWithPassword({ email, password });

      // 5. Redirect to Student Dashboard
      window.location.href = "/student/dashboard/?registered=true";
    } catch (err) {
      console.error("Registration processing error:", err);
      showFormError(err.message || "An error occurred while creating your account.");
      setSubmitting(false);
    }
  }

  function showFormError(msg) {
    formErrorMsg.textContent = msg;
    formErrorMsg.classList.remove("hidden");
  }

  function setSubmitting(isSubmitting) {
    submitFormBtn.disabled = isSubmitting;
    if (isSubmitting) {
      btnSpinner.classList.remove("hidden");
      btnText.textContent = "Processing Application...";
    } else {
      btnSpinner.classList.add("hidden");
      btnText.textContent = Number(currentForm?.fee_amount || 0) > 0 ? "Pay & Complete Registration" : "Submit & Register Account";
    }
  }
});
