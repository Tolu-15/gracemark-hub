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
                <td style="padding:32px 36px;background:linear-gradient(135deg,#1e293b,#0f172a);border-bottom:1px solid #1e3a5f;">
                  <p style="margin:0;font-size:13px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;">GraceMark Academic Portal</p>
                  <h1 style="margin:8px 0 0;font-size:22px;font-weight:900;color:#fff;">New Device Sign-In</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px 36px;">
                  <p style="margin:0 0 20px;font-size:14px;color:#cbd5e1;line-height:1.6;">
                    Hi <strong style="color:#fff;">${displayName}</strong>, a sign-in attempt was made from an unrecognised device or browser.
                    Use the code below to verify it's you.
                  </p>
                  <div style="background:#1e293b;border:2px solid #334155;border-radius:16px;padding:24px;text-align:center;margin:24px 0;">
                    <p style="margin:0 0 8px;font-size:11px;color:#64748b;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Your Verification Code</p>
                    <p style="margin:0;font-size:44px;font-weight:900;letter-spacing:12px;color:#f59e0b;font-family:monospace;">${otp}</p>
                  </div>
                  <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;">⏱ This code expires in <strong style="color:#f59e0b;">10 minutes</strong>.</p>
                  <p style="margin:0;font-size:12px;color:#64748b;">If you did not attempt to sign in, please change your password immediately and contact your school administrator.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;border-top:1px solid #1e293b;">
                  <p style="margin:0;font-size:11px;color:#475569;text-align:center;">GraceMark Academic Portal &bull; Automated Security Email</p>
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
                <td style="padding:32px 36px;background:linear-gradient(135deg,#1e293b,#0f172a);border-bottom:1px solid #1e3a5f;">
                  <p style="margin:0;font-size:13px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;">GraceMark Academic Portal</p>
                  <h1 style="margin:8px 0 0;font-size:22px;font-weight:900;color:#fff;">Password Updated ✓</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px 36px;">
                  <p style="margin:0 0 16px;font-size:14px;color:#cbd5e1;line-height:1.6;">
                    Hi <strong style="color:#fff;">${name}</strong>, your <strong style="color:#10b981;">${roleLabel}</strong> account password was successfully changed.
                  </p>
                  <p style="margin:0;font-size:12px;color:#64748b;">
                    If you did not make this change, please contact the school administrator immediately at <a href="mailto:${SENDER_EMAIL}" style="color:#f59e0b;">${SENDER_EMAIL}</a>.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;border-top:1px solid #1e293b;">
                  <p style="margin:0;font-size:11px;color:#475569;text-align:center;">GraceMark Academic Portal &bull; Automated Security Email</p>
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
