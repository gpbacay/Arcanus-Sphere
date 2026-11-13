// Run: node src/modules/account/local.check.ts   (Node 22.18+ strips the types)
import assert from "node:assert/strict";

// The browser's two stores, as far as local.ts uses them.
const storage = (): Storage => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) } as Storage;
};
Object.assign(globalThis, { localStorage: storage(), sessionStorage: storage() });

const { readSession, scopedHome, scopedKey, setScope, signIn, signUp, updateAccount, writeSession } = await import("./local.ts");

// The account made ahead of time signs in with its password, and nothing else does.
const owner = await signIn(" GPBacay ", "Admin1234!");
assert.deepEqual(owner, { id: "owner", username: "gpbacay", name: "Gianne Bacay" });
assert.equal(await signIn("gpbacay", "admin1234!"), "Username or password is incorrect.");
assert.equal(await signIn("nobody", "Admin1234!"), "Username or password is incorrect.");

// Signing up: validated, unique, hashed with Argon2id, never stored as typed.
assert.match((await signUp("ab", "longenough")) as string, /3 to 32/);
assert.match((await signUp("sam", "short")) as string, /8 characters/);
assert.match((await signUp("gpbacay", "longenough")) as string, /already taken/);
const sam = await signUp("Sam", "correct horse");
assert.ok(typeof sam === "object" && sam.username === "sam" && sam.name === "sam");
const saved = localStorage.getItem("arcanus_accounts_v1")!;
assert.match(saved, /\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
assert.doesNotMatch(saved, /correct horse|Admin1234/);
assert.deepEqual(await signIn("sam", "correct horse"), sam);

// A password change needs the current one; the old one then stops working.
assert.equal(await updateAccount(sam.id, { name: "Sam", current: "wrong", next: "battery staple" }), "Current password is incorrect.");
assert.deepEqual(await updateAccount(sam.id, { name: "Sam", current: "correct horse", next: "battery staple" }), { ...sam, name: "Sam" });
assert.equal(typeof (await signIn("sam", "correct horse")), "string");
assert.equal(typeof (await signIn("sam", "battery staple")), "object");

// The session: for the tab, or remembered; it follows the account's current name.
writeSession(sam, true);
assert.equal(readSession()?.name, "Sam");
assert.ok(localStorage.getItem("arcanus_session_v1") && !sessionStorage.getItem("arcanus_session_v1"));
writeSession(null);
assert.equal(readSession(), null);

// Each account reads and writes its own data; the owner keeps what was saved before accounts existed.
setScope(sam);
assert.deepEqual([scopedKey("chats_v1"), scopedHome()], [`arcanus_${sam.id}_chats_v1`, ["accounts", sam.id]]);
setScope(owner as { id: string; username: string; name: string });
assert.deepEqual([scopedKey("chats_v1"), scopedHome()], ["arcanus_chats_v1", []]);

console.log("local.check: ok");
