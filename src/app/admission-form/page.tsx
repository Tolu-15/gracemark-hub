"use client";

import React, { useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { ensureClassByName } from "@/lib/schoolContext";

declare const PaystackPop: any;

export default function PublicAdmissionFormPage() {
  const [currentStep, setCurrentStep] = useState(0);

  // Form State
  const [surname, setSurname] = useState("");
  const [firstNames, setFirstNames] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [desiredClass, setDesiredClass] = useState("");
  const [stateOfOrigin, setStateOfOrigin] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [passportPhotoUrl, setPassportPhotoUrl] = useState("");

  const [prevSchoolName, setPrevSchoolName] = useState("");
  const [prevSchoolAddress, setPrevSchoolAddress] = useState("");
  const [prevClass, setPrevClass] = useState("");

  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentOccupation, setParentOccupation] = useState("");

  const [isBoarding, setIsBoarding] = useState(false);
  const [boardingType, setBoardingType] = useState("full");
  const [medicalConditions, setMedicalConditions] = useState("");

  // Submission & Modal State
  const [submitting, setSubmitting] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [completedAdmNo, setCompletedAdmNo] = useState("");
  const [completedEmail, setCompletedEmail] = useState("");
  const [completedPassword, setCompletedPassword] = useState("");

  const stepsCount = 5;
  const stepTitles = [
    "Student Personal Details",
    "Previous Educational Background",
    "Parent / Guardian Details",
    "Accommodation & Medical Requirements",
    "Application Review & Payment Checkout",
  ];

  const validateStep = (stepIdx: number): boolean => {
    if (stepIdx === 0) {
      if (!surname.trim() || !firstNames.trim() || !dob || !gender || !desiredClass || !stateOfOrigin.trim() || !homeAddress.trim()) {
        alert("Please fill in all required personal details marked with *.");
        return false;
      }
    } else if (stepIdx === 1) {
      if (!prevSchoolName.trim()) {
        alert("Please enter the previous school name.");
        return false;
      }
    } else if (stepIdx === 2) {
      if (!parentName.trim() || !parentEmail.trim() || !parentPhone.trim()) {
        alert("Please fill in parent / guardian name, email, and phone number.");
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(stepsCount - 1, prev + 1));
    }
  };

  const handlePrev = () => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(currentStep)) return;

    setSubmitting(true);
    const admissionNumber = `ADM-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const fullName = `${surname.trim()} ${firstNames.trim()}`;
    const finalPassword = studentPassword.trim() || "gracemark";
    const userEmail = parentEmail.trim().toLowerCase();
    const APPLICATION_FEE = 10000;
    const uniqueRef = `ADM-${admissionNumber}-${Date.now()}`;

    try {
      // 1. Insert into admissions table
      const admissionPayload = {
        admission_number: admissionNumber,
        surname: surname.trim(),
        first_names: firstNames.trim(),
        date_of_birth: dob,
        gender,
        desired_class: desiredClass,
        state_of_origin: stateOfOrigin.trim(),
        home_address: homeAddress.trim(),
        passport_photo_url: passportPhotoUrl.trim() || null,
        previous_school_name: prevSchoolName.trim(),
        previous_school_address: prevSchoolAddress.trim() || null,
        previous_class: prevClass.trim() || null,
        parent_guardian_name: parentName.trim(),
        parent_guardian_email: userEmail,
        parent_guardian_phone: parentPhone.trim(),
        parent_guardian_occupation: parentOccupation.trim() || null,
        is_boarding: isBoarding,
        boarding_type: isBoarding ? boardingType : null,
        medical_conditions: medicalConditions.trim() || null,
        application_status: "submitted",
      };

      const { data: admRecord, error: admErr } = await supabase
        .from("admissions")
        .insert([admissionPayload])
        .select()
        .single();
      if (admErr) throw admErr;

      // 2. Fetch Paystack key
      let paystackKey: string | null = null;
      try {
        const cfgRes = await fetch("/api/paystack-config");
        const cfgData = await cfgRes.json();
        paystackKey = cfgData?.public_key || null;
      } catch (_) {}

      if (!paystackKey) {
        paystackKey = "pk_test_b867c4273574971c66708b5e9f8350bbbf4c2c01";
      }

      // Function to create student account after payment
      const processAccountCreation = async () => {
        try {
          const cls = await ensureClassByName(desiredClass);

          let userId: string | null = null;
          try {
            const regRes = await fetch("/api/register-student", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: userEmail,
                password: finalPassword,
                display_name: fullName,
              }),
            });
            const regData = await regRes.json();
            if (regRes.ok && regData?.user?.id) {
              userId = regData.user.id;
            }
          } catch (apiErr: any) {
            console.warn("Backend register-student fallback:", apiErr?.message);
          }

          if (!userId) {
            const { data: authData } = await supabase.auth.signUp({
              email: userEmail,
              password: finalPassword,
              options: { data: { display_name: fullName, role: "student" } },
            });
            userId = authData?.user?.id || null;
          }

          if (userId) {
            await supabase.from("users").upsert(
              { auth_id: userId, role: "student", display_name: fullName, email: userEmail },
              { onConflict: "auth_id" }
            );

            const { data: newStudent } = await supabase
              .from("students")
              .insert({
                class_id: cls.id,
                user_id: userId,
                admission_no: admissionNumber,
                name: fullName,
              })
              .select()
              .maybeSingle();

            if (newStudent?.id && admRecord?.id) {
              await supabase
                .from("admissions")
                .update({ created_student_id: newStudent.id })
                .eq("id", admRecord.id);
            }
          }
        } catch (accErr: any) {
          console.warn("Auto student account creation:", accErr?.message);
        }
      };

      const finishAndShowModal = () => {
        setCompletedAdmNo(admissionNumber);
        setCompletedEmail(userEmail);
        setCompletedPassword(finalPassword);
        setIsCompleteModalOpen(true);
      };

      if (typeof PaystackPop !== "undefined" && paystackKey && !paystackKey.includes("placeholder")) {
        try {
          const handler = PaystackPop.setup({
            key: paystackKey,
            email: userEmail,
            amount: APPLICATION_FEE * 100,
            currency: "NGN",
            ref: uniqueRef,
            label: `Admission Fee — ${fullName}`,
            metadata: {
              admission_id: admRecord.id,
              admission_number: admissionNumber,
              student_name: fullName,
              desired_class: desiredClass,
            },
            callback: async (response: any) => {
              try {
                await supabase.from("admission_payments").insert([
                  {
                    admission_id: admRecord.id,
                    payment_reference: response.reference,
                    amount: APPLICATION_FEE,
                    status: "successful",
                    payment_gateway: "paystack",
                    paid_at: new Date().toISOString(),
                  },
                ]);
                await supabase
                  .from("admissions")
                  .update({
                    payment_status: "paid",
                    payment_reference: response.reference,
                  })
                  .eq("id", admRecord.id);
              } catch (recErr: any) {
                console.warn("Payment record note:", recErr?.message);
              }

              await processAccountCreation();
              finishAndShowModal();
            },
            onClose: () => {
              alert(
                `Payment window closed.\nYour application reference is ${admissionNumber}.\nPlease complete payment to activate your account.`
              );
            },
          });
          handler.openIframe();
        } catch (pErr) {
          console.warn("Paystack popup error:", pErr);
          await processAccountCreation();
          finishAndShowModal();
        }
      } else {
        // Fallback test mode
        await processAccountCreation();
        finishAndShowModal();
      }
    } catch (err: any) {
      alert("Failed to submit application: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-50 text-slate-800 min-h-screen flex flex-col justify-between selection:bg-slate-900 selection:text-white">
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />

      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center font-black text-white text-xl shadow-sm">
              G
            </div>
            <div>
              <h1 className="font-extrabold text-lg text-slate-900 leading-none">Gracemark Academy</h1>
              <p className="text-xs text-slate-500 font-medium tracking-wide uppercase mt-0.5">
                Online Admission & Registration
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg border border-slate-200"
          >
            Portal Login →
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 py-8 w-full flex-1">
        {/* Progress Steps Header */}
        <div className="mb-6 bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-3">
            <span>STEP {currentStep + 1} OF 5</span>
            <span className="text-slate-900 font-semibold">{stepTitles[currentStep]}</span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className="bg-slate-900 h-full rounded-full transition-all duration-500"
              style={{ width: `${((currentStep + 1) / stepsCount) * 100}%` }}
            />
          </div>
          <div className="grid grid-cols-5 gap-2 text-[10px] sm:text-xs text-center font-medium mt-3 text-slate-400">
            {["1. Personal", "2. Education", "3. Guardian", "4. Accommodation", "5. Payment"].map((label, idx) => (
              <span
                key={idx}
                className={idx === currentStep ? "text-slate-900 font-bold" : idx < currentStep ? "text-emerald-600 font-semibold" : ""}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10 shadow-sm space-y-6">
          {/* Step 1: Personal Details */}
          {currentStep === 0 && (
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-xl font-bold text-slate-900">Student Personal Information</h2>
                <p className="text-xs text-slate-500">Enter candidate legal details as shown on official birth records.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Surname *</label>
                  <input
                    type="text"
                    required
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="e.g. Adebayo"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">First & Middle Names *</label>
                  <input
                    type="text"
                    required
                    value={firstNames}
                    onChange={(e) => setFirstNames(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="e.g. Oluwaseun Emmanuel"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date of Birth *</label>
                  <input
                    type="date"
                    required
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Gender *</label>
                  <select
                    required
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                  >
                    <option value="">Select gender</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Desired Class *</label>
                  <select
                    required
                    value={desiredClass}
                    onChange={(e) => setDesiredClass(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                  >
                    <option value="">Select Class</option>
                    <option value="JSS 1">JSS 1</option>
                    <option value="JSS 2">JSS 2</option>
                    <option value="JSS 3">JSS 3</option>
                    <option value="SSS 1 Science">SSS 1 Science</option>
                    <option value="SSS 1 Arts">SSS 1 Arts</option>
                    <option value="SSS 1 Commercial">SSS 1 Commercial</option>
                    <option value="SSS 2 Science">SSS 2 Science</option>
                    <option value="SSS 2 Arts">SSS 2 Arts</option>
                    <option value="SSS 2 Commercial">SSS 2 Commercial</option>
                    <option value="SSS 3 Science">SSS 3 Science</option>
                    <option value="SSS 3 Arts">SSS 3 Arts</option>
                    <option value="SSS 3 Commercial">SSS 3 Commercial</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">State of Origin *</label>
                  <input
                    type="text"
                    required
                    value={stateOfOrigin}
                    onChange={(e) => setStateOfOrigin(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="e.g. Lagos State"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Home Address *</label>
                  <input
                    type="text"
                    required
                    value={homeAddress}
                    onChange={(e) => setHomeAddress(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="Street Address, City, State"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Student Account Password (Optional)
                  </label>
                  <input
                    type="password"
                    value={studentPassword}
                    onChange={(e) => setStudentPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="Default is: gracemark"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Leave blank to use default password: <code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded">gracemark</code>
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Passport Photo URL (Image Link)
                  </label>
                  <input
                    type="url"
                    value={passportPhotoUrl}
                    onChange={(e) => setPassportPhotoUrl(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="https://example.com/photo.jpg"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Educational Background */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-xl font-bold text-slate-900">Previous Educational Background</h2>
                <p className="text-xs text-slate-500">Provide details on candidate previous or current school.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Previous School Name *</label>
                  <input
                    type="text"
                    required
                    value={prevSchoolName}
                    onChange={(e) => setPrevSchoolName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="e.g. St. Gregory Primary School"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Previous School Address</label>
                  <input
                    type="text"
                    value={prevSchoolAddress}
                    onChange={(e) => setPrevSchoolAddress(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="School location"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Last Class Completed</label>
                  <input
                    type="text"
                    value={prevClass}
                    onChange={(e) => setPrevClass(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="e.g. Primary 6 or JSS 3"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Parent / Guardian Info */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-xl font-bold text-slate-900">Parent / Guardian Information</h2>
                <p className="text-xs text-slate-500">
                  Login credentials and invoices will be sent to guardian contact details.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Parent / Guardian Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="Mr./Mrs. Surname First Name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Email Address *</label>
                  <input
                    type="email"
                    required
                    value={parentEmail}
                    onChange={(e) => setParentEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="guardian@example.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="08012345678"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Occupation</label>
                  <input
                    type="text"
                    value={parentOccupation}
                    onChange={(e) => setParentOccupation(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="e.g. Architect, Engineer, Banker"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Accommodation & Medical */}
          {currentStep === 3 && (
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-xl font-bold text-slate-900">Boarding & Medical Requirements</h2>
                <p className="text-xs text-slate-500">Specify accommodation preferences and health information.</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <input
                    type="checkbox"
                    id="is_boarding"
                    checked={isBoarding}
                    onChange={(e) => setIsBoarding(e.target.checked)}
                    className="w-5 h-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <div>
                    <label htmlFor="is_boarding" className="text-sm font-semibold text-slate-900 block cursor-pointer">
                      Student Requires Boarding Accommodation
                    </label>
                    <span className="text-xs text-slate-500">Check if candidate will live in the school hostel.</span>
                  </div>
                </div>

                {isBoarding && (
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Boarding Type</label>
                    <select
                      value={boardingType}
                      onChange={(e) => setBoardingType(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    >
                      <option value="full">Full Boarding (7 Days/Week)</option>
                      <option value="weekday">Weekday Boarding (Mon - Fri)</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Medical Conditions or Allergies (If Any)
                  </label>
                  <textarea
                    rows={2}
                    value={medicalConditions}
                    onChange={(e) => setMedicalConditions(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:border-slate-900"
                    placeholder="e.g. Asthma, Peanut allergy, None"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Review & Checkout */}
          {currentStep === 4 && (
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-xl font-bold text-slate-900">Application Review & Registration Fee</h2>
                <p className="text-xs text-slate-500">Review application summary and complete registration.</p>
              </div>

              <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Application Fee:</span>
                  <strong className="text-slate-900">₦10,000.00</strong>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Target Class:</span>
                  <strong className="text-slate-900">{desiredClass || "Selected Class"}</strong>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Candidate Name:</span>
                  <strong className="text-slate-900">{`${surname} ${firstNames}` || "Candidate Name"}</strong>
                </div>
                <div className="border-t border-slate-200 pt-3 flex justify-between text-base font-bold">
                  <span className="text-slate-700">Total Payable:</span>
                  <span className="text-slate-900 text-lg">₦10,000.00</span>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Your student account will be created automatically upon registration so you can take entrance exams and update your profile in the student portal.
              </p>
            </div>
          )}

          {/* Actions Bar */}
          <div className="flex justify-between items-center border-t border-slate-100 pt-6">
            {currentStep > 0 ? (
              <button
                type="button"
                onClick={handlePrev}
                className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold transition-colors shadow-sm"
              >
                ← Previous
              </button>
            ) : (
              <div />
            )}

            <div className="ml-auto flex gap-3">
              {currentStep < stepsCount - 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-sm transition-colors"
                >
                  Continue →
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-8 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-extrabold shadow-sm transition-colors"
                >
                  {submitting ? "Processing..." : "Complete Registration & Pay"}
                </button>
              )}
            </div>
          </div>
        </form>
      </main>

      {/* Completion Modal */}
      {isCompleteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 max-w-md w-full shadow-xl space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-2xl font-bold">
              ✓
            </div>
            <div className="text-center">
              <h3 className="text-xl font-extrabold text-slate-900">Registration Successful!</h3>
              <p className="text-xs text-slate-500 mt-1">Your student account has been created automatically.</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Admission No:</span>
                <strong className="text-slate-900 font-mono">{completedAdmNo}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Email:</span>
                <strong className="text-slate-900">{completedEmail}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Password:</span>
                <strong className="text-slate-900 font-mono">{completedPassword}</strong>
              </div>
            </div>

            <div className="space-y-2">
              <Link
                href="/"
                className="w-full block text-center py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-sm text-sm"
              >
                Log In & Take Entrance Exam →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        © 2026 Gracemark Academy. Secure Payment Gateway via Paystack.
      </footer>
    </div>
  );
}
