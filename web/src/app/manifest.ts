import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Celiador",
    short_name: "Celiador",
    description: "The AI editor for people who ship.",
    start_url: "/",
    display: "standalone",
    background_color: "#0E1113",
    theme_color: "#0E1113",
    icons: [
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
  };
}
