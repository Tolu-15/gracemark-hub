"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PoweredBy from "@/components/shared/PoweredBy";

type Step = "identify" | "student_notice" | "teacher_recovery" | "otp" | "new_password" | "success";

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("identify");
  const [identifier, setIdentifier] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [staffId, setStaffId] = useState("");
  const [authId, setAuthId] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [resetToken, setResetToken] = useState("");

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [countdown, setCountdown] = useState(0);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer for resending OTP
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Step 1: Submit Identifier
  async function handleIdentifySubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!identifier.trim()) {
      setError("Please enter your Email, Staff ID, or Admission Number.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Unable to find an account with the provided details.");
      }

      if (data.role === "student") {
        setStep("student_notice");
      } else if (data.role === "teacher" && data.requires_recovery_email) {
        setTeacherName(data.name || "Teacher");
        setStaffId(data.staff_id || "");
        setStep("teacher_recovery");
      } else if (data.auth_id) {
        // Direct OTP sent (Admin or matched teacher)
        setAuthId(data.auth_id);
        setEmailHint(data.email_hint || "your registered email");
        setCountdown(60);
        setStep("otp");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  // Step 2: Teacher Recovery Email Submit
  async function handleTeacherRecoverySubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!recoveryEmail.trim()) {
      setError("Please enter your registered recovery email.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          recovery_email: recoveryEmail.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Verification failed.");
      }

      setAuthId(data.auth_id);
      setEmailHint(data.email_hint || recoveryEmail);
      setCountdown(60);
      setStep("otp");
    } catch (err: any) {
      setError(err.message || "Failed to verify recovery email.");
    } finally {
      setLoading(false);
    }
  }

  // Resend OTP
  async function handleResendOtp() {
    if (countdown > 0 || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          recovery_email: recoveryEmail.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to resend code.");
      setCountdown(60);
    } catch (err: any) {
      setError(err.message || "Failed to resend code.");
    } finally {
      setLoading(false);
    }
  }

  // OTP Input Handlers
  function handleOtpChange(index: number, value: string) {
    const clean = value.replace(/\D/g, "").slice(0, 1);
    const next = [...otp];
    next[index] = clean;
    setOtp(next);
    if (clean && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(""));
      inputRefs.current[5]?.focus();
    }
  }

  // Step 3: Verify OTP
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const code = otp.join("");
    if (code.length < 6) {
      setError("Please enter the full 6-digit verification code.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          auth_id: authId,
          otp: code,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Invalid or expired verification code.");
      }

      setResetToken(data.reset_token);
      setStep("new_password");
    } catch (err: any) {
      setError(err.message || "Verification failed.");
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  // Step 4: Reset Password Submit
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match. Please ensure both fields are identical.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          auth_id: authId,
          reset_token: resetToken,
          new_password: newPassword,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to reset password.");
      }

      setStep("success");
      setTimeout(() => {
        router.replace("/");
      }, 2000);
    } catch (err: any) {
      setError(err.message || "Password update failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col justify-between relative overflow-x-hidden"
      style={{
        backgroundImage: "url('/assets/images/login-bg.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* Dark overlay for readability */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ backgroundColor: "rgba(7,17,32,0.72)" }}
      />

      {/* Main Card */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 py-10 z-10">
        <div
          className="w-full max-w-[440px] rounded-3xl p-6 sm:p-8 relative"
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid rgba(7,17,32,0.12)",
            boxShadow: "0 32px 80px rgba(7,17,32,0.6)",
          }}
        >
          {/* Logo / Lock Badge */}
          <div className="flex justify-center mb-5">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{
                backgroundColor: "rgba(7,17,32,0.08)",
                border: "1px solid rgba(7,17,32,0.15)",
              }}
            >
              <svg
                className="w-7 h-7"
                fill="none"
                stroke="#071120"
                strokeWidth="1.75"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-start gap-2">
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: IDENTIFY USER */}
          {step === "identify" && (
            <div>
              <div className="text-center mb-6">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: "#071120" }}>
                  Reset Password
                </h1>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Enter your registered Email, Staff ID, or Admission Number to recover your account.
                </p>
              </div>

              <form onSubmit={handleIdentifySubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="identifier"
                    className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: "#475569" }}
                  >
                    Account Identifier
                  </label>
                  <input
                    id="identifier"
                    type="text"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      setError(null);
                    }}
                    placeholder="e.g. GMT001 or admin@gracemark.edu.ng"
                    required
                    className="w-full px-3.5 py-2.5 sm:py-3 rounded-xl text-base sm:text-xs transition"
                    style={{
                      backgroundColor: "#f8fafc",
                      border: "1.5px solid #cbd5e1",
                      color: "#0f172a",
                      outline: "none",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = "#071120";
                      e.target.style.boxShadow = "0 0 0 3px rgba(7,17,32,0.1)";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "#cbd5e1";
                      e.target.style.boxShadow = "none";
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !identifier.trim()}
                  className="w-full py-3 px-4 font-bold rounded-xl transition flex items-center justify-center gap-2 mt-4 cursor-pointer disabled:opacity-50 text-xs sm:text-sm"
                  style={{
                    backgroundColor: "#071120",
                    color: "#ffffff",
                    boxShadow: "0 4px 14px rgba(7,17,32,0.4)",
                  }}
                >
                  {loading ? "Verifying Account..." : "Continue"}
                </button>

                <div className="pt-2 text-center">
                  <Link
                    href="/"
                    className="text-xs font-semibold hover:underline"
                    style={{ color: "#c9a84c" }}
                  >
                    Back to Sign In
                  </Link>
                </div>
              </form>
            </div>
          )}

          {/* STEP 2A: STUDENT NOTICE */}
          {step === "student_notice" && (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(201,168,76,0.15)" }}>
                <svg className="w-6 h-6" fill="none" stroke="#c9a84c" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>

              <div>
                <h2 className="text-lg sm:text-xl font-black" style={{ color: "#071120" }}>
                  Student Account Assistance
                </h2>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Student passwords cannot be reset online. For security and record integrity, please contact your school administrator or class teacher to reset your password.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-left text-xs text-slate-600 space-y-1.5">
                <p className="font-semibold text-slate-700">What to do:</p>
                <p>1. Reach out to the school administrative office or your class teacher.</p>
                <p>2. Provide your Admission Number (<strong>{identifier}</strong>).</p>
                <p>3. They will securely generate and provide you with a new password.</p>
              </div>

              <div className="pt-2 space-y-2">
                <Link
                  href="/"
                  className="block w-full py-3 px-4 font-bold rounded-xl text-center text-xs sm:text-sm text-white transition"
                  style={{
                    backgroundColor: "#071120",
                    boxShadow: "0 4px 14px rgba(7,17,32,0.4)",
                  }}
                >
                  Return to Sign In
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setStep("identify");
                    setError(null);
                  }}
                  className="text-xs font-semibold hover:underline cursor-pointer"
                  style={{ color: "#64748b" }}
                >
                  Try a different account
                </button>
              </div>
            </div>
          )}

          {/* STEP 2B: TEACHER RECOVERY EMAIL */}
          {step === "teacher_recovery" && (
            <div>
              <div className="text-center mb-6">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: "#071120" }}>
                  Teacher Password Recovery
                </h1>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Account confirmed for <strong>{teacherName}</strong> ({staffId}).
                  Please enter your personal recovery email to verify ownership.
                </p>
              </div>

              <form onSubmit={handleTeacherRecoverySubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="recoveryEmail"
                    className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: "#475569" }}
                  >
                    Personal Recovery Email
                  </label>
                  <input
                    id="recoveryEmail"
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => {
                      setRecoveryEmail(e.target.value);
                      setError(null);
                    }}
                    placeholder="Enter your personal recovery email"
                    required
                    className="w-full px-3.5 py-2.5 sm:py-3 rounded-xl text-base sm:text-xs transition"
                    style={{
                      backgroundColor: "#f8fafc",
                      border: "1.5px solid #cbd5e1",
                      color: "#0f172a",
                      outline: "none",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = "#071120";
                      e.target.style.boxShadow = "0 0 0 3px rgba(7,17,32,0.1)";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "#cbd5e1";
                      e.target.style.boxShadow = "none";
                    }}
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    This email must match the recovery email saved on your profile.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || !recoveryEmail.trim()}
                  className="w-full py-3 px-4 font-bold rounded-xl transition flex items-center justify-center gap-2 mt-4 cursor-pointer disabled:opacity-50 text-xs sm:text-sm"
                  style={{
                    backgroundColor: "#071120",
                    color: "#ffffff",
                    boxShadow: "0 4px 14px rgba(7,17,32,0.4)",
                  }}
                >
                  {loading ? "Verifying Email..." : "Verify & Send Code"}
                </button>

                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("identify");
                      setError(null);
                    }}
                    className="text-xs font-semibold hover:underline cursor-pointer"
                    style={{ color: "#64748b" }}
                  >
                    Change Account Identifier
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 3: OTP VERIFICATION */}
          {step === "otp" && (
            <div>
              <div className="text-center mb-6">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: "#071120" }}>
                  Verification Code
                </h1>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  We sent a 6-digit verification code to{" "}
                  <span className="font-semibold" style={{ color: "#c9a84c" }}>
                    {emailHint}
                  </span>
                  .<br />Enter it below to authorize your password reset.
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <div className="flex gap-2 justify-center" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        inputRefs.current[i] = el;
                      }}
                      id={`otp-${i}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      className="w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-black rounded-xl transition-all"
                      style={{
                        height: "3.25rem",
                        backgroundColor: "#f8fafc",
                        border: "1.5px solid #cbd5e1",
                        color: "#071120",
                        outline: "none",
                      }}
                      autoComplete="one-time-code"
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={loading || otp.join("").length < 6}
                  className="w-full py-3 rounded-xl text-xs uppercase tracking-wider cursor-pointer transition-all disabled:opacity-50 font-black"
                  style={{
                    backgroundColor: "#071120",
                    color: "#ffffff",
                    boxShadow: "0 4px 14px rgba(7,17,32,0.4)",
                  }}
                >
                  {loading ? "Verifying..." : "Verify Code & Proceed"}
                </button>

                <div className="text-center text-xs">
                  {countdown > 0 ? (
                    <p className="text-slate-500">
                      Resend code in{" "}
                      <span className="font-semibold" style={{ color: "#c9a84c" }}>
                        {countdown}s
                      </span>
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleResendOtp}
                      className="font-semibold underline cursor-pointer disabled:opacity-50"
                      style={{ color: "#c9a84c" }}
                    >
                      {loading ? "Sending..." : "Resend verification code"}
                    </button>
                  )}
                </div>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("identify");
                      setError(null);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700 underline cursor-pointer"
                  >
                    Start over
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 4: ENTER NEW PASSWORD */}
          {step === "new_password" && (
            <div>
              <div className="text-center mb-6">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: "#071120" }}>
                  Create New Password
                </h1>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Your identity has been verified. Enter a new password for your account.
                </p>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label
                    htmlFor="newPassword"
                    className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: "#475569" }}
                  >
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setError(null);
                      }}
                      placeholder="Minimum 6 characters"
                      required
                      minLength={6}
                      className="w-full px-3.5 py-2.5 sm:py-3 rounded-xl text-base sm:text-xs transition pr-11"
                      style={{
                        backgroundColor: "#f8fafc",
                        border: "1.5px solid #cbd5e1",
                        color: "#0f172a",
                        outline: "none",
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = "#071120";
                        e.target.style.boxShadow = "0 0 0 3px rgba(7,17,32,0.1)";
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = "#cbd5e1";
                        e.target.style.boxShadow = "none";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 transition p-1.5 cursor-pointer text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: "#475569" }}
                  >
                    Confirm New Password
                  </label>
                  <input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setError(null);
                    }}
                    placeholder="Re-enter new password"
                    required
                    minLength={6}
                    className="w-full px-3.5 py-2.5 sm:py-3 rounded-xl text-base sm:text-xs transition"
                    style={{
                      backgroundColor: "#f8fafc",
                      border: "1.5px solid #cbd5e1",
                      color: "#0f172a",
                      outline: "none",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = "#071120";
                      e.target.style.boxShadow = "0 0 0 3px rgba(7,17,32,0.1)";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "#cbd5e1";
                      e.target.style.boxShadow = "none";
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !newPassword || !confirmPassword}
                  className="w-full py-3 px-4 font-bold rounded-xl transition flex items-center justify-center gap-2 mt-4 cursor-pointer disabled:opacity-50 text-xs sm:text-sm"
                  style={{
                    backgroundColor: "#071120",
                    color: "#ffffff",
                    boxShadow: "0 4px 14px rgba(7,17,32,0.4)",
                  }}
                >
                  {loading ? "Updating Password..." : "Reset Password & Complete"}
                </button>
              </form>
            </div>
          )}

          {/* STEP 5: SUCCESS */}
          {step === "success" && (
            <div className="text-center space-y-4 py-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>

              <div>
                <h2 className="text-xl font-black" style={{ color: "#071120" }}>
                  Password Reset Successful
                </h2>
                <p className="text-xs text-slate-500 mt-2">
                  Your account password has been updated. You can now log in with your new credentials.
                </p>
              </div>

              <div className="pt-2">
                <Link
                  href="/"
                  className="block w-full py-3 px-4 font-bold rounded-xl text-center text-xs sm:text-sm text-white transition"
                  style={{
                    backgroundColor: "#071120",
                    boxShadow: "0 4px 14px rgba(7,17,32,0.4)",
                  }}
                >
                  Proceed to Sign In
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-slate-500 relative z-10">
        <PoweredBy />
      </footer>
    </div>
  );
}
