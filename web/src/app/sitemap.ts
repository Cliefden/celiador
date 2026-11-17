import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

const routes = [
  "/",
  "/start",
  "/features",
  "/download",
  "/pricing",
  "/docs",
  "/changelog",
  "/releases",
  "/switch",
  "/conduct",
  "/privacy",
  "/terms",
  "/about",
  "/contact",
];

// No lastModified: the site is rebuilt on every deploy, so the build date
// said every page changed every time, and search engines learn to ignore a
// lastmod that is always "now". Leave it out rather than state it wrongly.
export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({ url: `${site.url}${route}` }));
}
