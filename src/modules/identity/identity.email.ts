type IdentityEmailKind = "verification" | "password-reset";

export async function sendIdentityEmail(
  email: string,
  kind: IdentityEmailKind,
  token: string
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const frontendUrl = (
    process.env.FRONTEND_URL ?? "http://localhost:5173"
  ).replace(/\/$/, "");
  const verification = kind === "verification";
  const path = verification ? "/verify-email" : "/reset-password";
  const url = `${frontendUrl}${path}?token=${encodeURIComponent(token)}`;
  const subject = verification
    ? "Verify your Events account"
    : "Reset your Events password";
  const heading = verification
    ? "Verify your email address"
    : "Reset your password";
  const explanation = verification
    ? "Confirm this email address to finish securing your Events account."
    : "We received a request to reset the password for your Events account.";
  const action = verification ? "Verify email" : "Reset password";
  const expiry = verification
    ? process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES ?? "30"
    : process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? "30";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Events <no-reply@example.com>",
      to: [email],
      subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:40px auto;color:#171717"><h1>${heading}</h1><p>${explanation}</p><p><a href="${url}" style="display:inline-block;padding:12px 18px;background:#171717;color:#fff;text-decoration:none;border-radius:8px">${action}</a></p><p>This link expires in ${expiry} minutes and can only be used once. If you did not request this, you can ignore this email.</p><p>If the button does not work, copy this URL into your browser:</p><p>${url}</p></div>`
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Resend email delivery failed (${response.status}): ${details.slice(0, 500)}`
    );
  }
}
