// Accounts on this device, with no server: the same shape as OpenTill's lib/local-auth.ts. An account is a row in
// localStorage holding an Argon2id hash of its password (hash-wasm: the WebAssembly is inside the package, so signing
// in works offline). Whoever is signed in owns a scope: their conversations, their .arcanus/ files (instructions,
// memory, skills, books, what Hippocampus learned) and so the Arcanus those shape.
//
// This keeps accounts apart on a shared device. It does not encrypt anything: someone with this browser's developer
// tools can read every account's data. ponytail: derive a key from the password and encrypt each scope if that matters.
import { argon2Verify, argon2id } from "hash-wasm";

export type User = { id: string; username: string; name: string };
type Account = User & { hash: string };

const ACCOUNTS_KEY = "arcanus_accounts_v1";
const SESSION_KEY = "arcanus_session_v1";

/** The account everything saved before accounts existed belongs to: it keeps the old storage keys and the old home. */
const OWNER = "owner";
// gpbacay's account, made ahead of time. Only the Argon2id hash of the password is here.
const SEED: Account = {
  id: OWNER,
  username: "gpbacay",
  name: "Gianne Bacay",
  hash: "$argon2id$v=19$m=19456,t=2,p=1$OjwEvnEMNdW8KY3TeO280w$RBYrTwttIYgHqan9hTJPxFVSXylEC28xLbR6kL9oj7c",
};

// OWASP's Argon2id minimum: 19 MiB of memory, 2 passes, 1 lane. About 50 ms here.
const hashPassword = (password: string) =>
  argon2id({ password, salt: crypto.getRandomValues(new Uint8Array(16)), parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32, outputType: "encoded" });

function readAccounts(): Account[] {
  let saved: Account[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]");
    if (Array.isArray(parsed)) saved = parsed.filter((a) => a && typeof a.id === "string" && typeof a.username === "string" && typeof a.hash === "string");
  } catch {
    /* a bad save: only the seeded account is left */
  }
  return saved.some((a) => a.id === SEED.id) ? saved : [SEED, ...saved];
}
const writeAccounts = (accounts: Account[]) => localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
const asUser = ({ id, username, name }: User): User => ({ id, username, name });
const norm = (username: string) => username.trim().toLowerCase();

export const usernameError = (username: string) => (/^[a-z0-9][a-z0-9._-]{2,31}$/.test(norm(username)) ? "" : "Use 3 to 32 letters, numbers, dots, dashes or underscores.");
export const passwordError = (password: string) => (password.length >= 8 ? "" : "Use at least 8 characters.");

// ------------------------------------------------------------------ the session

function readFrom(storage: Storage): User | null {
  try {
    const user = JSON.parse(storage.getItem(SESSION_KEY) ?? "null") as User | null;
    // The account is read again, so a renamed or removed account never lives on in an old session.
    return (user && readAccounts().find((a) => a.id === user.id)) || null;
  } catch {
    return null;
  }
}

/** Who is signed in on this device, if anyone. */
export const readSession = (): User | null => {
  const user = readFrom(sessionStorage) ?? readFrom(localStorage);
  return user ? asUser(user) : null;
};

/** `remember`: stay signed in after the browser closes. Otherwise the session ends with the tab. */
export function writeSession(user: User | null, remember = false) {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  if (user) (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(asUser(user)));
}

/** Save a changed user without changing how long the session lasts. */
export const refreshSession = (user: User) => writeSession(user, localStorage.getItem(SESSION_KEY) !== null);

// ------------------------------------------------------------------ signing in and up

/** The user, or the reason they could not sign in. */
export async function signIn(username: string, password: string): Promise<User | string> {
  const account = readAccounts().find((a) => a.username === norm(username));
  // The same answer for a wrong name and a wrong password, so neither is confirmed.
  if (!account || !(await argon2Verify({ password, hash: account.hash }).catch(() => false))) return "Username or password is incorrect.";
  return asUser(account);
}

export async function signUp(username: string, password: string, name = ""): Promise<User | string> {
  const error = usernameError(username) || passwordError(password);
  if (error) return error;
  const accounts = readAccounts();
  if (accounts.some((a) => a.username === norm(username))) return "That username is already taken on this device.";
  const account: Account = { id: crypto.randomUUID(), username: norm(username), name: name.trim() || norm(username), hash: await hashPassword(password) };
  writeAccounts([...accounts, account]);
  return asUser(account);
}

/** Change the name, and the password when `next` is given (the current one is asked for). The user, or what was wrong. */
export async function updateAccount(id: string, body: { name: string; current?: string; next?: string }): Promise<User | string> {
  const accounts = readAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account) return "Sign in on this device first.";
  if (!body.name.trim()) return "Enter your name.";
  let hash = account.hash;
  if (body.next) {
    if (passwordError(body.next)) return passwordError(body.next);
    if (!(await argon2Verify({ password: body.current ?? "", hash }).catch(() => false))) return "Current password is incorrect.";
    hash = await hashPassword(body.next);
  }
  const updated: Account = { ...account, name: body.name.trim(), hash };
  writeAccounts(accounts.map((a) => (a.id === id ? updated : a)));
  return asUser(updated);
}

// ------------------------------------------------------------------ the scope: whose data is read and written

let scope = "";

/** Call before anything of the user's is read. The owner's scope is the unprefixed one, where the data already was. */
export const setScope = (user: User | null) => void (scope = !user || user.id === OWNER ? "" : user.id);

/** A localStorage key of the signed-in account: "chats_v1" -> "arcanus_chats_v1", or "arcanus_<id>_chats_v1". */
export const scopedKey = (name: string) => (scope ? `arcanus_${scope}_${name}` : `arcanus_${name}`);

/** Where the signed-in account's private files live under the browser's own file system: [] is the root. */
export const scopedHome = () => (scope ? ["accounts", scope] : []);
