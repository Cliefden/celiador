// GET /build-info: which commit this build of the site is. The deploy workflow
// (web-deploy.yml) builds with CELIADOR_COMMIT set and its health gate compares
// this against the commit it deployed, so a restart that kept serving the old
// build fails the deploy instead of passing on "the page says Celiador".
// Rendered once at build time; a local build without the variable says "dev".
export const dynamic = "force-static";

export function GET() {
  return Response.json(
    { commit: process.env.CELIADOR_COMMIT || "dev" },
    { headers: { "cache-control": "no-store" } },
  );
}
