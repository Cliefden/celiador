/**
 * Tests for account deletion.
 * 
 * Run with: tsx src/account.test.ts
 * 
 * These are minimal smoke tests since the daemon has no test infrastructure yet.
 * They verify the integration points exist and handle errors correctly.
 */

import { createApp } from "./app";

async function testAccountDeletion() {
  const app = createApp();
  
  console.log("Testing account deletion endpoint...\n");
  
  // Test 1: Missing auth (only meaningful in supabase/token mode)
  if (process.env.SUPABASE_JWT_SECRET || process.env.CELIADOR_TOKEN) {
    console.log("Test 1: DELETE /api/account without auth should return 401");
    const noAuth = await app.request("/api/account", { method: "DELETE" });
    const noAuthStatus = noAuth.status;
    const noAuthBody = await noAuth.json() as { error?: string };
    console.log(`  Status: ${noAuthStatus}`);
    console.log(`  Body: ${JSON.stringify(noAuthBody)}`);
    if (noAuthStatus !== 401 || noAuthBody.error !== "unauthorized") {
      throw new Error("Expected 401 unauthorized");
    }
    console.log("  ✓ Pass\n");
  } else {
    console.log("Test 1: Skipped (auth mode is 'none', no auth required)\n");
  }
  
  // Test 2: Invalid token (only meaningful in supabase/token mode)
  if (process.env.SUPABASE_JWT_SECRET || process.env.CELIADOR_TOKEN) {
    console.log("Test 2: DELETE /api/account with invalid token should return 401");
    const badToken = await app.request("/api/account", {
      method: "DELETE",
      headers: { Authorization: "Bearer invalid.token.here" }
    });
    const badTokenStatus = badToken.status;
    const badTokenBody = await badToken.json() as { error?: string };
    console.log(`  Status: ${badTokenStatus}`);
    console.log(`  Body: ${JSON.stringify(badTokenBody)}`);
    if (badTokenStatus !== 401) {
      throw new Error("Expected 401 for invalid token");
    }
    console.log("  ✓ Pass\n");
  } else {
    console.log("Test 2: Skipped (auth mode is 'none', no real tokens)\n");
  }
  
  // Test 3: DB not configured (works in any auth mode)
  console.log("Test 3: DELETE /api/account should handle DB not configured gracefully");
  const dbTest = await app.request("/api/account", { 
    method: "DELETE",
    headers: process.env.CELIADOR_TOKEN 
      ? { Authorization: `Bearer ${process.env.CELIADOR_TOKEN}` }
      : {}
  });
  const dbTestStatus = dbTest.status;
  const dbTestBody = await dbTest.json() as { error?: string; ok?: boolean };
  console.log(`  Status: ${dbTestStatus}`);
  console.log(`  Body: ${JSON.stringify(dbTestBody)}`);
  if (!process.env.DATABASE_URL && (dbTestStatus !== 503 || !dbTestBody.error?.includes("database not configured"))) {
    throw new Error("Expected 503 database not configured when DATABASE_URL is unset");
  }
  console.log("  ✓ Pass\n");
  
  console.log("All tests passed! ✓");
}

// Run tests
testAccountDeletion().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
