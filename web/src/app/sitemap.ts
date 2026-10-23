import type { MetadataRoute } from "next";

const baseUrl = "https://celiador.ai";

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

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
  }));
}
