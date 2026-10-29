/**
 * Which sign-in methods this environment actually offers, so clients can hide
 * the buttons that would dead-end (GitHub is `GITHUB_OAUTH_ENABLED` on GoTrue;
 * magic links need an SMTP mailer). Read from GoTrue's public settings
 * (`/auth/v1/settings` — `external.email`, `external.github`); whether SMTP is
 * configured isn't visible there, so the env says it: `CELIADOR_MAGIC_LINK=0`
 * (deploy/provision-env.sh writes it from CELIADOR_SMTP_PASS).
 *
 * Served on GET /api/config as `signIn`; omitted when SUPABASE_URL is unset or
 * GoTrue can't be reached, in which case clients keep every button (the older
 * behaviour).
 */

export interface SignInMethods {
  password: boolean;
  magicLink: boolean;
  github: boolean;
}

const OK_TTL_MS = 5 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 3000;

let cached: { value: SignInMethods | undefined; until: number } | null = null;
let inflight: Promise<SignInMethods | undefined> | null = null;

export async function signInMethods(): Promise<SignInMethods | undefined> {
  if (cached && cached.until > Date.now()) return cached.value;
  if (!inflight) {
    inflight = fetchSignInMethods()
      .then((value) => {
        cached = { value, until: Date.now() + (value ? OK_TTL_MS : FAIL_TTL_MS) };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function fetchSignInMethods(): Promise<SignInMethods | undefined> {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!base) return undefined;
  const headers: Record<string, string> = {};
  if (process.env.SUPABASE_ANON_KEY) headers.apikey = process.env.SUPABASE_ANON_KEY;
  try {
    const res = await fetch(`${base}/auth/v1/settings`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return undefined;
    const settings = (await res.json()) as { external?: Record<string, unknown> };
    const external = settings.external ?? {};
    const email = external.email === true;
    return {
      password: email,
      magicLink: email && process.env.CELIADOR_MAGIC_LINK !== "0",
      github: external.github === true,
    };
  } catch (err) {
    console.warn("[signin] GoTrue settings unavailable:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
