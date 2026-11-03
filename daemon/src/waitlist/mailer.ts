import nodemailer from "nodemailer";
import { ENV } from "../config";
import type { ConfirmMail, WaitlistName } from "./store";

/**
 * Sends the waitlist's double-opt-in mail over SMTP (Migadu in our
 * environments — the same mailbox GoTrue's magic links use):
 *
 *   CELIADOR_SMTP_HOST / CELIADOR_SMTP_PORT (587, STARTTLS) / CELIADOR_SMTP_USER / CELIADOR_SMTP_PASS
 *   CELIADOR_MAIL_FROM   optional, default `Celiador <CELIADOR_SMTP_USER>`
 *
 * Without SMTP the waitlist is off (POST /api/waitlist answers 503 and the site
 * falls back to a mailto: link) — except in a `local` environment, where the
 * links are printed to the log instead so the flow can be tried end to end.
 */

export type SendMail = (mail: ConfirmMail) => Promise<void>;

const LABEL: Record<WaitlistName, string> = {
  "early-access": "Celiador news and early access",
  windows: "Celiador for Windows",
  linux: "Celiador for Linux",
};

function compose(mail: ConfirmMail): { subject: string; text: string; html: string } {
  const what = mail.lists.map((l) => LABEL[l]).join(" and ");
  const subject = "Confirm your Celiador sign-up";
  const text = [
    `Someone (hopefully you) asked to hear about: ${what}.`,
    "",
    "Confirm with this link:",
    mail.confirmUrl,
    "",
    "We store only this address and which list you joined, and mail you only about that.",
    "If this wasn't you, ignore this mail: the request is forgotten in 7 days. Or remove it now:",
    mail.unsubscribeUrl,
    "",
    "— Celiador, https://celiador.ai/privacy",
  ].join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html =
    `<div style="font:15px/1.5 -apple-system,system-ui,sans-serif;color:#1a1d1f;max-width:520px">` +
    `<p>Someone (hopefully you) asked to hear about: <strong>${esc(what)}</strong>.</p>` +
    `<p><a href="${esc(mail.confirmUrl)}" style="display:inline-block;background:#7FD1AE;color:#0B1A13;border-radius:10px;padding:12px 18px;font-weight:600;text-decoration:none">Confirm my sign-up</a></p>` +
    `<p style="color:#555;font-size:13px">We store only this address and which list you joined, and mail you only about that. ` +
    `If this wasn't you, ignore this mail: the request is forgotten in 7 days. Or <a href="${esc(mail.unsubscribeUrl)}">remove it now</a>.</p>` +
    `<p style="color:#555;font-size:13px">— Celiador · <a href="https://celiador.ai/privacy">Privacy</a></p></div>`;
  return { subject, text, html };
}

let override: SendMail | null | undefined;

/** Tests swap the transport (undefined restores the real one, null = "no mailer"). */
export function overrideWaitlistMailerForTests(fn: SendMail | null | undefined): void {
  override = fn;
  cached = undefined;
}

let cached: SendMail | null | undefined;

/** The configured sender, or null when this environment can't send the mail. */
export function waitlistMailer(): SendMail | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const host = process.env.CELIADOR_SMTP_HOST;
  const user = process.env.CELIADOR_SMTP_USER;
  const pass = process.env.CELIADOR_SMTP_PASS;
  if (host && user && pass) {
    const port = Number(process.env.CELIADOR_SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user, pass },
      connectionTimeout: 15_000,
      socketTimeout: 30_000,
    });
    const from = process.env.CELIADOR_MAIL_FROM || `Celiador <${user}>`;
    cached = async (mail) => {
      const { subject, text, html } = compose(mail);
      await transport.sendMail({
        from,
        to: mail.email,
        subject,
        text,
        html,
        headers: {
          "List-Unsubscribe": `<${mail.unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
    };
  } else if (ENV === "local") {
    cached = async (mail) => {
      console.log(`[waitlist] no SMTP (local): confirm ${mail.confirmUrl}  ·  unsubscribe ${mail.unsubscribeUrl}`);
    };
  } else {
    cached = null;
  }
  return cached;
}
