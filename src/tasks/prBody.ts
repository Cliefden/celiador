import type { SessionUsage } from "../sessions/types";

/**
 * Reading the agent's structured reply back, and writing the pull request body
 * from it. The task prompt (store.ts, promptFor) asks the agent to open with a
 * "Plan:" block and close with a "## Self-review" section; this module is the
 * one place that knows what those look like. Pure functions, no I/O — the editor
 * composes the same body itself when it opens the PR without the GitHub App, so
 * keep the shape here in step with celiador-ai's copy.
 */

/** Longest plan the issue comment carries. */
export const MAX_PLAN_CHARS = 1500;
/** Longest "What the agent did" paragraph when it is the whole final message. */
export const MAX_SUMMARY_CHARS = 2000;

/** The agent's self-review, as far as it could be read. */
export interface SelfReview {
  /** The "what changed" part, as one paragraph. */
  whatChanged?: string;
  /** What the agent said it was unsure about. */
  unsure: string[];
  /** What it did not run or verify (and why). */
  notVerified: string[];
}

/** A heading or bold label, with its markdown stripped: "## What changed" → "What changed". */
function label(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/\*\*|__/g, "")
    .trim();
}

/** A list item's text without its marker, else the trimmed line. */
function item(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
}

const CHANGED = /^(?:what\s+(?:i\s+)?changed|changes?|what\s+was\s+done|done)\b\s*[:—–-]?\s*(.*)$/i;
const UNSURE = /^(?:(?:what\s+)?(?:i(?:'m|\s+am)\s+)?(?:unsure|uncertain|not\s+sure)(?:\s+about)?|open\s+questions?|doubts?|uncertaint(?:y|ies))\b\s*[:—–-]?\s*(.*)$/i;
const NOT_VERIFIED =
  /^(?:(?:what\s+(?:i\s+)?)?(?:did\s+not|didn'?t|not)\s+(?:run|verif(?:y|ied)|test(?:ed)?|check(?:ed)?)(?:\s*(?:\/|or|and)\s*(?:run|verif(?:y|ied)|test(?:ed)?|check(?:ed)?))*|unverified|not\s+verified|not\s+run|untested|skipped)\b\s*[:—–-]?\s*(.*)$/i;

/**
 * The "## Self-review" section of a final message, split into its three parts.
 * Tolerant of the forms the model actually produces: sub-headings, bold labels,
 * or bullets led by "What changed:", "Unsure:", "Not verified:" (and their
 * paraphrases). Without any labels the whole section is "what changed"; without
 * a section at all everything is empty.
 */
export function parseSelfReview(text: string): SelfReview {
  const review: SelfReview = { unsure: [], notVerified: [] };
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^self[- ]review\b/i.test(label(l)));
  if (start < 0) return review;
  const level = (/^\s*(#{1,6})\s/.exec(lines[start]!)?.[1] ?? "").length;
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const h = /^\s*(#{1,6})\s/.exec(line);
    if (h && (level === 0 || h[1]!.length <= level)) break; // the next section of the message
    if (/^\s*-{3,}\s*$/.test(line)) break;
    section.push(line);
  }

  let current: "changed" | "unsure" | "notVerified" | undefined;
  const changed: string[] = [];
  let labelled = false;
  const push = (bucket: typeof current, value: string) => {
    if (!value) return;
    if (bucket === "changed") changed.push(value);
    else if (bucket === "unsure") review.unsure.push(value);
    else if (bucket === "notVerified") review.notVerified.push(value);
  };
  for (const raw of section) {
    if (!raw.trim()) continue;
    const l = label(raw);
    let m: RegExpExecArray | null;
    if ((m = CHANGED.exec(l))) { current = "changed"; labelled = true; push(current, m[1]!.trim()); continue; }
    if ((m = UNSURE.exec(l))) { current = "unsure"; labelled = true; push(current, m[1]!.trim()); continue; }
    if ((m = NOT_VERIFIED.exec(l))) { current = "notVerified"; labelled = true; push(current, m[1]!.trim()); continue; }
    push(current ?? "changed", item(raw));
  }
  if (!labelled && changed.length === 0) return review;
  const paragraph = changed.join(current === undefined && !labelled ? "\n" : " ").replace(/\s+\n/g, "\n").trim();
  if (paragraph) review.whatChanged = paragraph;
  return review;
}

/**
 * The plan at the top of an assistant message: the lines after a "Plan:" heading
 * (plain, bold or `#`-headed), up to the first blank line, the next heading or
 * {@link MAX_PLAN_CHARS}. Undefined when the message has no such heading — the
 * caller uses that to decide whether this is "the plan message".
 */
export function extractPlan(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^plan\s*:?\s*$/i.test(label(l)) || /^plan\s*:\s*\S/i.test(label(l)));
  if (start < 0) return undefined;
  const out: string[] = [];
  const inline = /^plan\s*:\s*(\S.*)$/i.exec(label(lines[start]!))?.[1];
  if (inline) out.push(inline.trim());
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) { if (out.length) break; else continue; }
    if (/^\s*#{1,6}\s/.test(line) || /^self[- ]review\b/i.test(label(line))) break;
    out.push(line.trimEnd());
    if (out.length >= 12) break;
  }
  const plan = out.join("\n").trim();
  if (!plan) return undefined;
  return plan.length > MAX_PLAN_CHARS ? `${plan.slice(0, MAX_PLAN_CHARS - 1)}…` : plan;
}

/** "4 s", "12 min", "1 h 05 min". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "$1.23 (12.3k in / 4.0k out tokens)". */
export function formatUsage(usage: SessionUsage): string {
  const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
  return `$${usage.costUsd.toFixed(2)} (${k(usage.inputTokens)} in / ${k(usage.outputTokens)} out tokens)`;
}

export interface PrBodyInput {
  /** The issue the PR closes, when the task came from one. */
  readonly issueNumber?: number;
  /** The run's final assistant message (the editor's `summary`, or the cloud run's last message). */
  readonly summary?: string;
  /** Where it ran: the editor's machine name, or "the cloud". */
  readonly runBy: string;
  readonly changedFiles?: number;
  readonly elapsedMs?: number;
  readonly usage?: SessionUsage;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * The pull request body (contract §4): what the agent did, its self-review, and a
 * footer with where it ran, the size, the time and the cost. Parts that aren't
 * known are left out of the footer rather than shown as blanks.
 */
export function composePrBody(input: PrBodyInput): string {
  const summary = (input.summary ?? "").trim();
  const review = parseSelfReview(summary);
  const did = review.whatChanged ?? (summary ? clip(summary, MAX_SUMMARY_CHARS) : "_No summary was reported for this run._");
  const bullets = [...review.unsure.map((u) => `- Unsure: ${u}`), ...review.notVerified.map((n) => `- Not verified: ${n}`)];
  const selfReview = bullets.length ? bullets.join("\n") : "_The agent flagged nothing it was unsure about or left unverified._";
  const footer = [`Run by Celiador on ${input.runBy}`];
  if (input.changedFiles !== undefined) footer.push(`${input.changedFiles} ${input.changedFiles === 1 ? "file" : "files"}`);
  if (input.elapsedMs !== undefined) footer.push(formatElapsed(input.elapsedMs));
  if (input.usage) footer.push(formatUsage(input.usage));
  return [
    ...(input.issueNumber !== undefined ? [`Closes #${input.issueNumber}`, ""] : []),
    "## What the agent did",
    did,
    "",
    "## Self-review",
    selfReview,
    "",
    "---",
    footer.join(" · "),
  ].join("\n");
}
