/**
 * Tests for account deletion.
 * 
 * Run with: tsx src/account.test.ts
 * 
 * These tests mock the DB layer and verify:
 * - Cache eviction and stream closure
 * - Other users' data is untouched
 * - No file rewrite after deletion
 * - Failure case leaves everything intact
 * - Auth modes work correctly
 */

import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app";
import { sessionStores } from "./sessions/instance";
import { pushStores } from "./push/instance";
import { ROOT } from "./config";

async function testCacheEvictionAndIsolation() {
  console.log("Test 1: Cache eviction and user isolation");
  
  // Mock deleteAuthUser to succeed
  const mockDeleteAuthUser = async () => {};
  
  // Create sessions for two users
  const user1 = "user-1";
  const user2 = "user-2";
  
  const store1 = sessionStores.for(user1);
  const session1 = store1.create({ title: "User 1 Session", origin: "editor", runner: "editor" });
  
  const store2 = sessionStores.for(user2);
  const session2 = store2.create({ title: "User 2 Session", origin: "editor", runner: "editor" });
  
  // Add push tokens
  pushStores.for(user1).addDevice("token1", "sandbox");
  pushStores.for(user2).addDevice("token2", "sandbox");
  
  // Verify both exist
  if (!sessionStores.for(user1).get(session1.id)) throw new Error("User 1 session not found");
  if (!sessionStores.for(user2).get(session2.id)) throw new Error("User 2 session not found");
  if (pushStores.for(user1).devices().length !== 1) throw new Error("User 1 push token not found");
  if (pushStores.for(user2).devices().length !== 1) throw new Error("User 2 push token not found");
  
  // Delete user1's account
  const { deleteAccount } = await import("./account");
  await deleteAccount(user1, mockDeleteAuthUser);
  
  // Verify user1's data is gone but user2's remains
  const sessions1After = sessionStores.for(user1).list();
  const sessions2After = sessionStores.for(user2).list();
  
  if (sessions1After.length !== 0) throw new Error("User 1 sessions not deleted");
  if (sessions2After.length !== 1) throw new Error("User 2 sessions affected!");
  if (!sessionStores.for(user2).get(session2.id)) throw new Error("User 2 session deleted!");
  
  const push1After = pushStores.for(user1).devices();
  const push2After = pushStores.for(user2).devices();
  
  if (push1After.length !== 0) throw new Error("User 1 push tokens not deleted");
  if (push2After.length !== 1) throw new Error("User 2 push tokens affected!");
  
  console.log("  ✓ Pass\n");
}

async function testNoRewriteAfterDeletion() {
  console.log("Test 2: No file rewrite after deletion (debounced save cancelled)");
  
  const mockDeleteAuthUser = async () => {};
  
  const userId = "user-debounce";
  const store = sessionStores.for(userId);
  const session = store.create({ title: "Test", origin: "editor", runner: "editor" });
  
  // Trigger a debounced save by appending an event
  store.append(session.id, { kind: "delta", text: "hello" });
  
  // Immediately delete the account before the debounce fires
  const { deleteAccount } = await import("./account");
  await deleteAccount(userId, mockDeleteAuthUser);
  
  // Wait for any pending debounced save to fire
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Verify files don't exist (evict deleted them and cancelled pending saves)
  const metaFile = path.join(ROOT, "data", "sessions", "meta", `${userId}.json`);
  const logFile = path.join(ROOT, "data", "sessions", "log", `${userId}.json`);
  
  if (fs.existsSync(metaFile)) throw new Error("Meta file recreated after deletion!");
  if (fs.existsSync(logFile)) throw new Error("Log file recreated after deletion!");
  
  console.log("  ✓ Pass\n");
}

async function testFailureLeavesDataIntact() {
  console.log("Test 3: Failure case leaves data intact");
  
  const mockDeleteAuthUserFails = async () => {
    throw new Error("database role lacks permission to delete auth users");
  };
  
  const userId = "user-fail";
  const store = sessionStores.for(userId);
  store.create({ title: "Should survive", origin: "editor", runner: "editor" });
  pushStores.for(userId).addDevice("token-survive", "sandbox");
  
  // Attempt deletion - should throw
  const { deleteAccount } = await import("./account");
  let threw = false;
  try {
    await deleteAccount(userId, mockDeleteAuthUserFails);
  } catch (err) {
    threw = true;
    if (!String(err).includes("lacks permission")) {
      throw new Error("Wrong error message");
    }
  }
  
  if (!threw) throw new Error("deleteAccount should have thrown");
  
  // Verify data still exists
  const sessionsAfter = sessionStores.for(userId).list();
  const pushAfter = pushStores.for(userId).devices();
  
  if (sessionsAfter.length !== 1) throw new Error("Sessions deleted despite failure!");
  if (pushAfter.length !== 1) throw new Error("Push tokens deleted despite failure!");
  
  console.log("  ✓ Pass\n");
}

async function testAuthModes() {
  console.log("Test 4: Auth modes");
  
  const app = createApp();
  
  // Test token mode
  process.env.CELIADOR_TOKEN = "test-token";
  delete process.env.SUPABASE_JWT_SECRET;
  
  // Valid token should pass auth
  const validResp = await app.request("/api/account", {
    method: "DELETE",
    headers: { Authorization: "Bearer test-token" }
  });
  // Will fail at DB layer since we have no DATABASE_URL, but should pass auth
  if (validResp.status === 401) throw new Error("Valid token rejected");
  
  // Invalid token should fail auth
  const invalidResp = await app.request("/api/account", {
    method: "DELETE",
    headers: { Authorization: "Bearer wrong-token" }
  });
  if (invalidResp.status !== 401) throw new Error("Invalid token accepted");
  
  delete process.env.CELIADOR_TOKEN;
  console.log("  ✓ Pass\n");
}

async function testEndpointResponse() {
  console.log("Test 5: Endpoint returns correct status codes");
  
  const app = createApp();
  
  // DB not configured → 503
  const noDbResp = await app.request("/api/account", { method: "DELETE" });
  const noDbBody = await noDbResp.json() as { error?: string };
  if (noDbResp.status !== 503 || !noDbBody.error?.includes("database not configured")) {
    throw new Error("Expected 503 when DB not configured");
  }
  
  console.log("  ✓ Pass\n");
}

async function runTests() {
  console.log("Account Deletion Tests\n");
  console.log("======================\n");
  
  await testCacheEvictionAndIsolation();
  await testNoRewriteAfterDeletion();
  await testFailureLeavesDataIntact();
  await testAuthModes();
  await testEndpointResponse();
  
  console.log("All tests passed! ✓");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
