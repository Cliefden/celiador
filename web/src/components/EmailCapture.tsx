"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon } from "./icons";

// The waitlist lives on the daemon (POST /api/waitlist, same origin as the site
// on celiador.ai and the test/dev hosts; NEXT_PUBLIC_CELIADOR_API overrides the
// base for local work). It is double opt-in: the daemon mails a confirmation
// link and the address is only on the list after that click, so the success
// state says "check your inbox", never "you're on the list". The daemon answers
// the same way whether or not it already knows the address.
//
// When the daemon can't take sign-ups (no mailer configured → 503, unreachable,
// a local `next dev`), the form falls back to the old pre-filled mail to
// hello@celiador.ai and says so.
const WAITLIST_ADDRESS = "hello@celiador.ai";
const API = (process.env.NEXT_PUBLIC_CELIADOR_API ?? "").replace(/\/+$/, "");

export type WaitlistName = "early-access" | "windows" | "linux";

export function EmailCapture({
  compact = false,
  lists = ["early-access"],
  subject: subjectText = "Celiador early access",
  cta = "Get notified",
  hint = "One email when there's news. No spam.",
}: {
  compact?: boolean;
  /** Which list(s) the address joins. */
  lists?: WaitlistName[];
  /** What the sign-up is for, e.g. "Celiador for Windows" (used in the mailto: fallback). */
  subject?: string;
  cta?: string;
  hint?: string;
}) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: hidden from people, filled by naive bots
  const [state, setState] = useState<"idle" | "sending" | "done" | "fallback">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setError("Please enter a valid email.");
      return;
    }
    setError("");
    setState("sending");
    try {
      const res = await fetch(`${API}/api/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address, lists, website }),
      });
      if (res.status === 202) {
        setState("done");
        return;
      }
      if (res.status === 400 || res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That didn't work. Please try again.");
        setState("idle");
        return;
      }
    } catch {
      // Network error: fall through to the mail fallback.
    }
    setState("fallback");
  }

  const box =
    "flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-white " +
    (compact ? "" : "mx-auto max-w-md");

  if (state === "done") {
    return (
      <div className={box} role="status">
        <CheckIcon className="h-5 w-5 shrink-0 text-brand" />
        <span>
          Check your inbox: click the link in the email we just sent to confirm. Nothing there in a
          few minutes? Look in spam, or write to{" "}
          <a href={`mailto:${WAITLIST_ADDRESS}`} className="underline hover:text-brand">
            {WAITLIST_ADDRESS}
          </a>
          .
        </span>
      </div>
    );
  }

  if (state === "fallback") {
    const mailto = `mailto:${WAITLIST_ADDRESS}?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(
      `Please add ${email.trim()} to the list for: ${subjectText}.`
    )}`;
    return (
      <div className={box} role="status">
        <span>
          We couldn&apos;t save your sign-up just now.{" "}
          <a href={mailto} className="underline hover:text-brand">
            Send us a quick email instead
          </a>{" "}
          and we&apos;ll add you by hand.
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={"w-full " + (compact ? "" : "mx-auto max-w-md")} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm text-white outline-none transition placeholder:text-fog-dim focus:border-brand"
          aria-label="Email address"
        />
        {/* Honeypot. Off-screen rather than display:none so simple bots still see it. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="shrink-0 rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : cta}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[#ff6b6b]">{error}</p>}
      <p className="mt-2 text-xs text-fog-dim">
        {hint} We&apos;ll email you a link to confirm. We keep only your address and which list you
        joined; every email has an unsubscribe link.{" "}
        <Link href="/privacy#waitlist" className="underline hover:text-white">
          Privacy
        </Link>
      </p>
    </form>
  );
}
