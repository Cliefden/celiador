import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

// The share card for every page (og:image and twitter:image; Next also uses
// it for the Twitter card when no twitter-image file exists). Rendered once
// at build time.
export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#08080a",
          backgroundImage: "radial-gradient(circle at 85% 10%, rgba(124,107,255,0.35), transparent 55%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="88" height="88" viewBox="0 0 32 32">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#7c6bff" />
                <stop offset="1" stopColor="#26d3ee" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="#0e0e13" />
            <path d="M22 12a7 7 0 1 0 0 8" fill="none" stroke="url(#g)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>{site.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>{site.tagline}</div>
          <div style={{ fontSize: 32, color: "#9a9aa7", lineHeight: 1.35, maxWidth: 1000 }}>
            Label a GitHub issue, an agent opens the pull request. Review and merge from your phone.
          </div>
        </div>
        <div style={{ fontSize: 28, color: "#7c6bff" }}>celiador.ai</div>
      </div>
    ),
    size,
  );
}
