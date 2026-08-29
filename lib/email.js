// The only place in the app that knows how mail is sent. Everything else asks
// for "a verification code to this address" and gets back an ok/error result,
// so swapping Resend for something else touches this file and nothing else.
//
// No SDK on purpose: one fetch keeps the app dependency-free, the same reason
// lib/auth.js hashes with node:crypto instead of bcrypt.

const ENDPOINT = "https://api.resend.com/emails";

// Callers decide what to do about a failure, so this returns an error rather
// than throwing past a route handler. A failed send must never leave a pending
// record behind that the person cannot complete.
export async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  // Loud rather than silent: a missing key in development looks exactly like a
  // successful send if we swallow it, and the bug surfaces days later.
  if (!key || !from) {
    console.error("email: RESEND_API_KEY or MAIL_FROM is not set — nothing was sent");
    return { ok: false, error: "email is not configured on this deployment" };
  }

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
  } catch (err) {
    console.error("email: request to the mail provider failed", err);
    return { ok: false, error: "could not send the email — try again in a moment" };
  }

  if (!res.ok) {
    console.error(`email: provider refused (${res.status})`, await res.text().catch(() => ""));
    return { ok: false, error: "could not send the email — try again in a moment" };
  }

  return { ok: true };
}

/* ---------- the two messages we send ---------- */

// Copy lives here so wording changes never touch route code.
function codeMessage({ heading, lead }, code) {
  return `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
  <h1 style="font-size:18px;font-weight:600;margin:0 0 12px">${heading}</h1>
  <p style="font-size:14px;line-height:1.6;margin:0 0 24px;color:#555">${lead}</p>
  <p style="font-size:30px;font-weight:600;letter-spacing:.22em;margin:0 0 24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</p>
  <p style="font-size:13px;line-height:1.6;color:#777;margin:0">This code is good for ten minutes. If you did not ask for it, you can ignore this email — nothing was created.</p>
</div>`;
}

export function sendVerificationCode(to, code) {
  return sendMail({
    to,
    subject: `${code} is your Artifacts verification code`,
    html: codeMessage(
      {
        heading: "Confirm your email address",
        lead: "Enter this code on the signup page to finish creating your account.",
      },
      code
    ),
  });
}

export function sendResetCode(to, code) {
  return sendMail({
    to,
    subject: `${code} is your Artifacts password reset code`,
    html: codeMessage(
      {
        heading: "Reset your password",
        lead: "Enter this code to choose a new password. Doing so signs you out everywhere else.",
      },
      code
    ),
  });
}
