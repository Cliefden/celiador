import type { NextConfig } from "next";

// Security headers for every page the site serves (#104). The daemon's /api/*
// routes on the same host are proxied by Caddy straight to the daemon and do
// not pass through Next, so they are not covered here.
//
// The CSP is deliberately loose where Next needs it: the App Router inlines its
// bootstrap and RSC payload as <script> tags, and Tailwind/next/font emit inline
// styles, so script-src and style-src keep 'unsafe-inline' (nonces would force
// every page to render dynamically). The useful parts are the rest: no foreign
// script, frame, object or form origins, and no framing of the site.
const isDev = process.env.NODE_ENV !== "production";

// The waitlist form posts to NEXT_PUBLIC_CELIADOR_API when it is set (local
// work against another daemon); in production it is unset and same-origin.
function apiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_CELIADOR_API;
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

const csp = [
  "default-src 'self'",
  // 'unsafe-eval' only for next dev (React Refresh); never in a production build.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${apiOrigin() ? ` ${apiOrigin()}` : ""}${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // No includeSubDomains/preload: other celiador.ai hosts (mail autoconfig
  // and the like) are not ours to promise HTTPS for. Browsers ignore HSTS on
  // plain-http responses, so local `next start` is unaffected.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // This project sits inside a multi-repo folder; pin the tracing root to
  // silence Next's "inferred workspace root" warning from sibling lockfiles.
  outputFileTracingRoot: import.meta.dirname,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
