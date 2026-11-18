import type { Metadata } from "next";
import { site } from "@/lib/site";

// Per-page metadata. Next merges `openGraph` and `twitter` shallowly per
// segment, so a page that sets only `title` would still share the homepage's
// og:title and og:url. Every page goes through this so its canonical URL,
// Open Graph and Twitter card describe that page. The image is
// app/opengraph-image.tsx; a page that sets its own `openGraph` loses the
// file-based image inherited from the root, so it is named here explicitly.
const shareImage = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${site.name} — ${site.tagline}`,
};

export function pageMetadata({
  path,
  title,
  description,
}: {
  /** Route path, e.g. "/pricing". Resolved against metadataBase. */
  path: string;
  /** Page title without the " — Celiador" suffix (the layout template adds it). */
  title: string;
  description: string;
}): Metadata {
  const fullTitle = `${title} — ${site.name}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName: site.name,
      type: "website",
      images: [shareImage],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [shareImage],
    },
  };
}
