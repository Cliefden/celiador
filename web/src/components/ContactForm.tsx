"use client";

import { useState } from "react";
import { CheckIcon } from "./icons";

// There is no contact backend yet, so the form must not claim the message was
// sent. It composes a pre-filled email to hello@celiador.ai in the visitor's
// mail app and says so. When a CRM/email endpoint exists, POST to it instead
// and only then show a "sent" confirmation.
const CONTACT_ADDRESS = "hello@celiador.ai";

export function ContactForm() {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-4 text-sm text-white">
        <CheckIcon className="h-5 w-5 shrink-0 text-brand" />
        <span>
          Your message is ready in your mail app — hit send there and we&apos;ll get back to you. If
          nothing opened, email{" "}
          <a href={`mailto:${CONTACT_ADDRESS}`} className="underline hover:text-brand">
            {CONTACT_ADDRESS}
          </a>{" "}
          directly.
        </span>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const field = (name: string) => String(data.get(name) ?? "").trim();
        const company = field("company");
        const subject = `Celiador inquiry from ${field("name")}${company ? ` (${company})` : ""}`;
        const body = `${field("message")}\n\n— ${field("name")} <${field("email")}>${company ? `, ${company}` : ""}`;
        window.location.href = `mailto:${CONTACT_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        setDone(true);
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" required className={inputCls} placeholder="Ada Lovelace" />
        </Field>
        <Field label="Email">
          <input name="email" required type="email" className={inputCls} placeholder="you@company.com" />
        </Field>
      </div>
      <Field label="Company (optional)">
        <input name="company" className={inputCls} placeholder="Acme Inc." />
      </Field>
      <Field label="How can we help?">
        <textarea
          name="message"
          required
          rows={5}
          className={inputCls + " resize-none"}
          placeholder="Tell us about your team and what you're building…"
        />
      </Field>
      <button
        type="submit"
        className="w-full rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white transition hover:brightness-110 sm:w-auto"
      >
        Compose email
      </button>
      <p className="text-xs text-fog-dim">Opens your mail app with this message pre-filled.</p>
    </form>
  );
}

const inputCls =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm text-white outline-none transition placeholder:text-fog-dim focus:border-brand";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fog">{label}</span>
      {children}
    </label>
  );
}
