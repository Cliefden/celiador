import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This project sits inside a multi-repo folder; pin the tracing root to
  // silence Next's "inferred workspace root" warning from sibling lockfiles.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
