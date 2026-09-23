"use client";

import { useState } from "react";
import { CheckIcon } from "./icons";

// NOTE: Not wired to a backend. Point `submit` at your email/CRM endpoint.
export function ContactForm() {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-4 text-sm text-white">
        <CheckIcon className="h-5 w-5 text-brand" />
        Thanks — we&apos;ll get back to you shortly.
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setDone(true);
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input required className={inputCls} placeholder="Ada Lovelace" />
        </Field>
        <Field label="Email">
          <input required type="email" className={inputCls} placeholder="you@company.com" />
        </Field>
      </div>
      <Field label="Company (optional)">
        <input className={inputCls} placeholder="Acme Inc." />
      </Field>
      <Field label="How can we help?">
        <textarea
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
        Send message
      </button>
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
