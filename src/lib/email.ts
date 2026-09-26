/**
 * Brevo (formerly Sendinblue) transactional email helper.
 * Uses the REST API directly — no npm package required.
 *
 * Required env vars:
 *   BREVO_API_KEY
 *   BREVO_SENDER_EMAIL   (defaults to noreply@gracemarkportal.com.ng)
 *   BREVO_SENDER_NAME    (defaults to GraceMark Academic Portal)
 */

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

const SENDER_EMAIL =
  process.env.BREVO_SENDER_EMAIL ?? "noreply@gracemarkportal.com.ng";
const SENDER_NAME =
  process.env.BREVO_SENDER_NAME ?? "GraceMark Academic Portal";

interface BrevoEmailPayload {
  sender: { name: string; email: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
}

async function sendEmail(payload: BrevoEmailPayload): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn("[email] BREVO_API_KEY not set — email not sent.");
    return;
  }

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${text}`);
  }
}

/** Sends a 6-digit OTP to an admin for new-device verification. */
export async function sendOtpEmail(
  toEmail: string,
  otp: string,
  name?: string
): Promise<void> {
  const displayName = name || "Administrator";

  await sendEmail({
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    to: [{ email: toEmail, name: displayName }],
    subject: "GraceMark Portal — New Device Verification Code",
    htmlContent: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
          <tr><td align="center">
            <table width="100%" style="max-width:520px;background:#0f172a;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="padding:32px 36px;background:#071120;border-bottom:1px solid #1e3a5f;">
                  <p style="margin:0;font-size:13px;font-weight:700;color:#c9a84c;letter-spacing:2px;text-transform:uppercase;">GraceMark Academic Portal</p>
                  <h1 style="margin:8px 0 0;font-size:22px;font-weight:900;color:#fff;">New Device Sign-In</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px 36px;">
                  <p style="margin:0 0 20px;font-size:14px;color:#cbd5e1;line-height:1.6;">
                    Hi <strong style="color:#fff;">${displayName}</strong>, a sign-in attempt was made from an unrecognised device or browser.
                    Use the code below to verify it's you.
                  </p>
                  <div style="background:#071120;border:2px solid #334155;border-radius:16px;padding:24px;text-align:center;margin:24px 0;">
                    <p style="margin:0 0 8px;font-size:11px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Your Verification Code</p>
                    <p style="margin:0;font-size:44px;font-weight:900;letter-spacing:12px;color:#c9a84c;font-family:monospace;">${otp}</p>
                  </div>
                  <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;">This code expires in <strong style="color:#c9a84c;">10 minutes</strong>.</p>
                  <p style="margin:0;font-size:12px;color:#64748b;">If you did not attempt to sign in, please change your password immediately and contact your school administrator.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;border-top:1px solid #1e293b;text-align:center;">
                  <p style="margin:0;font-size:11px;color:#94a3b8;">GraceMark Academic Portal &bull; <a href="https://www.gracemarkportal.com.ng/" style="color:#38bdf8;text-decoration:none;">www.gracemarkportal.com.ng</a></p>
                  <p style="margin:6px 0 0;font-size:10px;font-weight:700;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;">Powered by <span style="color:#cbd5e1;">TDev</span></p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  });
}

/** Sends a 6-digit OTP specifically for password reset verification. */
export async function sendPasswordResetOtpEmail(
  toEmail: string,
  otp: string,
  name?: string
): Promise<void> {
  const displayName = name || "User";

  await sendEmail({
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    to: [{ email: toEmail, name: displayName }],
    subject: "GraceMark Portal — Password Reset Code",
    htmlContent: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
          <tr><td align="center">
            <table width="100%" style="max-width:520px;background:#0f172a;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="padding:32px 36px;background:#071120;border-bottom:1px solid #1e3a5f;">
                  <p style="margin:0;font-size:13px;font-weight:700;color:#c9a84c;letter-spacing:2px;text-transform:uppercase;">GraceMark Academic Portal</p>
                  <h1 style="margin:8px 0 0;font-size:22px;font-weight:900;color:#fff;">Password Reset Request</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px 36px;">
                  <p style="margin:0 0 20px;font-size:14px;color:#cbd5e1;line-height:1.6;">
                    Hello <strong style="color:#fff;">${displayName}</strong>, we received a request to reset your password.
                    Use the 6-digit verification code below to authorize the password reset.
                  </p>
                  <div style="background:#071120;border:2px solid #334155;border-radius:16px;padding:24px;text-align:center;margin:24px 0;">
                    <p style="margin:0 0 8px;font-size:11px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Password Reset Code</p>
                    <p style="margin:0;font-size:44px;font-weight:900;letter-spacing:12px;color:#c9a84c;font-family:monospace;">${otp}</p>
                  </div>
                  <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;">This code expires in <strong style="color:#c9a84c;">10 minutes</strong>.</p>
                  <p style="margin:0;font-size:12px;color:#64748b;">If you did not request this password reset, you can safely ignore this email. Your current password remains unchanged.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;border-top:1px solid #1e293b;text-align:center;">
                  <p style="margin:0;font-size:11px;color:#94a3b8;">GraceMark Academic Portal &bull; <a href="https://www.gracemarkportal.com.ng/" style="color:#38bdf8;text-decoration:none;">www.gracemarkportal.com.ng</a></p>
                  <p style="margin:6px 0 0;font-size:10px;font-weight:700;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;">Powered by <span style="color:#cbd5e1;">TDev</span></p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  });
}

/** Sends a confirmation email after a successful password change. */
export async function sendPasswordChangedEmail(
  toEmail: string,
  name: string,
  role: string
): Promise<void> {
  const roleLabel =
    role === "admin" ? "Administrator" : role === "teacher" ? "Teacher" : "Student";

  await sendEmail({
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    to: [{ email: toEmail, name }],
    subject: "GraceMark Portal — Password Changed Successfully",
    htmlContent: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8" /></head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
          <tr><td align="center">
            <table width="100%" style="max-width:520px;background:#0f172a;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="padding:32px 36px;background:#071120;border-bottom:1px solid #1e3a5f;">
                  <p style="margin:0;font-size:13px;font-weight:700;color:#c9a84c;letter-spacing:2px;text-transform:uppercase;">GraceMark Academic Portal</p>
                  <h1 style="margin:8px 0 0;font-size:22px;font-weight:900;color:#fff;">Password Updated</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px 36px;">
                  <p style="margin:0 0 16px;font-size:14px;color:#cbd5e1;line-height:1.6;">
                    Hi <strong style="color:#fff;">${name}</strong>, your <strong style="color:#c9a84c;">${roleLabel}</strong> account password was successfully changed.
                  </p>
                  <p style="margin:0;font-size:12px;color:#64748b;">
                    If you did not make this change, please contact the school administrator immediately at <a href="mailto:${SENDER_EMAIL}" style="color:#c9a84c;">${SENDER_EMAIL}</a>.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;border-top:1px solid #1e293b;text-align:center;">
                  <p style="margin:0;font-size:11px;color:#94a3b8;">GraceMark Academic Portal &bull; <a href="https://www.gracemarkportal.com.ng/" style="color:#38bdf8;text-decoration:none;">www.gracemarkportal.com.ng</a></p>
                  <p style="margin:6px 0 0;font-size:10px;font-weight:700;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;">Powered by <span style="color:#cbd5e1;">TDev</span></p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  });
}

/** Sends a welcome email to a newly created teacher with login credentials and class/subject allocation form link. */
export async function sendTeacherWelcomeEmail(params: {
  toEmail: string;
  name: string;
  staffId: string;
  password: string;
  formUrl?: string;
}): Promise<void> {
  const formUrl = params.formUrl || "https://forms.gle/bhiJ4CUkXJbHRP5p6";
  const loginUrl = "https://www.gracemarkportal.com.ng/";

  await sendEmail({
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    to: [{ email: params.toEmail, name: params.name }],
    subject: "GraceMark Academy — Staff Portal Access & Subject Allocation",
    htmlContent: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GraceMark Academy Staff Portal</title>
      </head>
      <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:36px 16px;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 10px 25px -5px rgba(0,0,0,0.06),0 8px 10px -6px rgba(0,0,0,0.04);">
                
                <!-- Gold Top Brand Accent -->
                <tr>
                  <td style="height:4px;background:#c9a84c;font-size:0;line-height:0;">&nbsp;</td>
                </tr>

                <!-- Header -->
                <tr>
                  <td style="padding:32px 36px 26px;background:#0f172a;text-align:left;">
                    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#c9a84c;letter-spacing:2px;text-transform:uppercase;">
                      GraceMark Academy
                    </p>
                    <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;">
                      Staff Portal Account &amp; Onboarding
                    </h1>
                    <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;">
                      Official Academic &amp; Result Management Portal
                    </p>
                  </td>
                </tr>

                <!-- Main Content Body -->
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 16px;font-size:15px;color:#0f172a;line-height:1.6;">
                      Dear <strong style="color:#0f172a;">${params.name}</strong>,
                    </p>
                    <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">
                      Welcome to the teaching staff at <strong>GraceMark Academy</strong>. An official teacher account has been provisioned for you on the school portal.
                    </p>

                    <!-- Important Notice Callout: "pls go through this info" -->
                    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #2563eb;border-radius:10px;padding:16px 20px;margin:22px 0;">
                      <p style="margin:0;font-size:14px;font-weight:800;color:#1e40af;">
                        📌 Important: Please go through this info carefully
                      </p>
                      <p style="margin:4px 0 0;font-size:13px;color:#1e3a8a;line-height:1.5;">
                        Follow the two simple steps below to access your account and submit the subjects and classes you handle this session.
                      </p>
                    </div>

                    <!-- Step 1: Sign-In Credentials -->
                    <div style="margin:26px 0;">
                      <div style="margin-bottom:10px;">
                        <span style="display:inline-block;background:#0f172a;color:#ffffff;font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;margin-right:6px;">STEP 1</span>
                        <span style="font-size:14px;font-weight:700;color:#0f172a;">Your Sign-In Credentials</span>
                      </div>

                      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;">
                        <table width="100%" cellpadding="6" cellspacing="0" style="font-size:13px;">
                          <tr>
                            <td style="color:#64748b;width:130px;font-weight:600;">Teacher ID:</td>
                            <td>
                              <span style="font-family:Consolas,'Courier New',monospace;font-size:14px;font-weight:800;color:#0284c7;background:#e0f2fe;padding:2px 10px;border-radius:6px;border:1px solid #bae6fd;">
                                ${params.staffId}
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td style="color:#64748b;font-weight:600;">Login Email:</td>
                            <td>
                              <strong style="color:#0f172a;font-size:14px;">${params.toEmail}</strong>
                            </td>
                          </tr>
                          <tr>
                            <td style="color:#64748b;font-weight:600;">Initial Password:</td>
                            <td>
                              <span style="font-family:Consolas,'Courier New',monospace;font-size:14px;font-weight:800;color:#b45309;background:#fef3c7;padding:2px 10px;border-radius:6px;border:1px solid #fde68a;">
                                ${params.password}
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td style="color:#64748b;font-weight:600;">Portal Login URL:</td>
                            <td>
                              <a href="${loginUrl}" target="_blank" style="color:#2563eb;font-weight:700;text-decoration:underline;">
                                ${loginUrl}
                              </a>
                            </td>
                          </tr>
                        </table>

                        <p style="margin:14px 0 0;font-size:12px;color:#64748b;line-height:1.5;">
                          <em>Tip: You can sign in with either your <strong>Teacher ID</strong> (${params.staffId}) or your <strong>Email Address</strong>.</em>
                        </p>
                      </div>

                      <!-- Sign In Button -->
                      <div style="text-align:center;margin:18px 0 0;">
                        <a href="${loginUrl}" target="_blank" style="display:inline-block;background:#0f172a;color:#ffffff;padding:13px 30px;border-radius:10px;font-weight:700;font-size:13px;text-decoration:none;letter-spacing:0.3px;box-shadow:0 3px 10px rgba(15,23,42,0.18);">
                          Sign In to Portal &rarr;
                        </a>
                      </div>
                    </div>

                    <!-- Step 2: Subject & Class Allocation Form -->
                    <div style="margin:30px 0 20px;">
                      <div style="margin-bottom:10px;">
                        <span style="display:inline-block;background:#c9a84c;color:#0f172a;font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;margin-right:6px;">STEP 2</span>
                        <span style="font-size:14px;font-weight:700;color:#0f172a;">Submit Your Subjects &amp; Classes</span>
                      </div>

                      <div style="background:#fffbeb;border:1px solid #fef3c7;border-left:4px solid #c9a84c;border-radius:12px;padding:20px 22px;">
                        <p style="margin:0 0 10px;font-size:13px;color:#78350f;line-height:1.6;">
                          Please complete this form to submit the subjects you teach and the classes you handle this academic session so your student rosters, attendance register, and gradebooks can be set up:
                        </p>

                        <div style="text-align:center;margin:16px 0 12px;">
                          <a href="${formUrl}" target="_blank" style="display:inline-block;background:#c9a84c;color:#0f172a;padding:12px 26px;border-radius:8px;font-weight:800;font-size:13px;text-decoration:none;letter-spacing:0.3px;box-shadow:0 2px 8px rgba(201,168,76,0.3);">
                            Fill Subject &amp; Class Form &rarr;
                          </a>
                        </div>

                        <p style="margin:8px 0 0;font-size:11px;color:#92400e;text-align:center;word-break:break-all;">
                          Direct link: <a href="${formUrl}" target="_blank" style="color:#b45309;text-decoration:underline;">${formUrl}</a>
                        </p>
                      </div>
                    </div>

                    <!-- Security Reminder -->
                    <div style="border-top:1px solid #f1f5f9;margin-top:28px;padding-top:18px;">
                      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                        🔒 <strong>Security Reminder:</strong> You may be requested to update your temporary password upon first login. Please keep your credentials confidential.
                      </p>
                    </div>

                  </td>
                </tr>

                <!-- Footer with "Powered by TDev" -->
                <tr>
                  <td style="padding:24px 36px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
                    <p style="margin:0;font-size:12px;font-weight:700;color:#334155;">
                      GraceMark Academy Academic Portal
                    </p>
                    <p style="margin:4px 0 0;font-size:11px;color:#64748b;">
                      Portal URL: <a href="${loginUrl}" target="_blank" style="color:#2563eb;text-decoration:none;">www.gracemarkportal.com.ng</a>
                    </p>
                    <div style="margin-top:16px;padding-top:12px;border-top:1px dashed #cbd5e1;">
                      <p style="margin:0;font-size:11px;font-weight:800;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;">
                        Powered by <span style="color:#0f172a;font-weight:900;">TDev</span>
                      </p>
                    </div>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  });
}


export interface AssignmentChange {
  kind: "added" | "removed";
  role: "Class Teacher" | "Subject Teacher";
  className: string;
  subjectName?: string;
}

/** Tells a teacher which class / subject assignments were added or removed since the last notice. */
export async function sendAssignmentUpdateEmail(params: {
  toEmail: string;
  name: string;
  session: string;
  changes: AssignmentChange[];
}): Promise<void> {
  const loginUrl = "https://www.gracemarkportal.com.ng/";
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const row = (c: AssignmentChange) => {
    const colour = c.kind === "added" ? "#047857" : "#b91c1c";
    const bg = c.kind === "added" ? "#ecfdf5" : "#fef2f2";
    const label = c.kind === "added" ? "Assigned" : "Removed";
    const what = c.subjectName
      ? `${esc(c.subjectName)} &mdash; ${esc(c.className)}`
      : `Class Teacher &mdash; ${esc(c.className)}`;
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${what}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">
        <span style="background:${bg};color:${colour};font-size:11px;font-weight:800;padding:3px 9px;border-radius:6px;">${label}</span>
      </td>
    </tr>`;
  };

  await sendEmail({
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    to: [{ email: params.toEmail, name: params.name }],
    subject: "GraceMark Academy — Your Class & Subject Assignments Were Updated",
    htmlContent: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:36px 16px;">
          <tr><td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
              <tr><td style="height:4px;background:#c9a84c;font-size:0;line-height:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:28px 36px;background:#0f172a;">
                  <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#c9a84c;letter-spacing:2px;text-transform:uppercase;">GraceMark Academy</p>
                  <h1 style="margin:0;font-size:21px;font-weight:800;color:#ffffff;">Assignment Update</h1>
                  <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;">Session ${esc(params.session)}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:30px 36px;">
                  <p style="margin:0 0 14px;font-size:15px;color:#0f172a;">Dear <strong>${esc(params.name)}</strong>,</p>
                  <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.6;">
                    Your class and subject assignments on the GraceMark portal have changed. Here is what is new:
                  </p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                    ${params.changes.map(row).join("")}
                  </table>
                  <div style="text-align:center;margin:24px 0 4px;">
                    <a href="${loginUrl}" target="_blank" style="display:inline-block;background:#0f172a;color:#ffffff;padding:12px 28px;border-radius:10px;font-weight:700;font-size:13px;text-decoration:none;">Open Portal &rarr;</a>
                  </div>
                  <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">If anything looks wrong, please contact the school administrator.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
                  <p style="margin:0;font-size:11px;color:#64748b;">GraceMark Academic Portal &bull; <a href="${loginUrl}" style="color:#2563eb;text-decoration:none;">www.gracemarkportal.com.ng</a></p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  });
}
