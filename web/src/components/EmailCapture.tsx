"use client";

import { useState } from "react";
import { CheckIcon } from "./icons";

// NOTE: This form is not wired to a backend yet. On submit it just shows a
// success state. Point `submit` at your list provider (Supabase, Loops, etc.).
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
    // TODO: replace with a real request to your waitlist backend.
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
        <CheckIcon className="h-5 w-5 text-brand" />
        You&apos;re on the list. We&apos;ll email you the moment the Mac build is ready.
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
      <p className="mt-2 text-xs text-fog-dim">No spam. One email when the preview opens.</p>
    </form>
  );
}
