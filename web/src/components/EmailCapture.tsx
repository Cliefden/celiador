"use client";

import { useState } from "react";
import { CheckIcon } from "./icons";

// There is no waitlist backend yet, so this form must not pretend to store the
// address. It hands off to the visitor's mail app (a pre-filled message to
// hello@celiador.ai) and says so honestly. When a list provider exists
// (Supabase, Loops, …), POST to it in `submit` and only then show "on the list".
const WAITLIST_ADDRESS = "hello@celiador.ai";

export function EmailCapture({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Please enter a valid email.");
      return;
    }
    setError("");
    const subject = encodeURIComponent("Celiador early access");
    const body = encodeURIComponent(`Please add ${email} to the Celiador early-access list.`);
    window.location.href = `mailto:${WAITLIST_ADDRESS}?subject=${subject}&body=${body}`;
    setDone(true);
  }

  if (done) {
    return (
      <div
        className={
          "flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-white " +
          (compact ? "" : "mx-auto max-w-md")
        }
      >
        <CheckIcon className="h-5 w-5 shrink-0 text-brand" />
        <span>
          Almost there — send the email that just opened to join the list. If nothing opened,
          write to{" "}
          <a href={`mailto:${WAITLIST_ADDRESS}`} className="underline hover:text-brand">
            {WAITLIST_ADDRESS}
          </a>
          .
        </span>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={"w-full " + (compact ? "" : "mx-auto max-w-md")}
      noValidate
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          inputMode="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm text-white outline-none transition placeholder:text-fog-dim focus:border-brand"
          aria-label="Email address"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white transition hover:brightness-110"
        >
          Get early access
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[#ff6b6b]">{error}</p>}
      <p className="mt-2 text-xs text-fog-dim">
        Opens your mail app with a pre-filled request. No spam — one email when the preview opens.
      </p>
    </form>
  );
}
