"use client";

// Who is signed in, as a store the rest of Arcanus reads. The scope is set before the store changes, so whatever
// renders for a signed-in user already reads that user's data.
import { Store } from "@/shared/store";
import { readSession, refreshSession, setScope, signIn, signUp, updateAccount, writeSession, type User } from "./local";

/** `ready` is false until the saved session has been read on the client. */
export const account = new Store<{ user: User | null; ready: boolean }>({ user: null, ready: false });

/** Read the saved session. Call once on the client. */
export function restoreAccount() {
  const user = readSession();
  setScope(user);
  account.set({ user, ready: true });
}

/** Sign in, or sign up and sign in. Resolves to what went wrong, or "" when it worked. */
export async function enter(creating: boolean, body: { username: string; password: string; name?: string; remember: boolean }) {
  const result = creating ? await signUp(body.username, body.password, body.name) : await signIn(body.username, body.password);
  if (typeof result === "string") return result;
  writeSession(result, creating || body.remember); // a new account stays signed in, as in OpenTill
  setScope(result);
  account.set({ user: result });
  return "";
}

/** Sign out. The page loads again, so nothing of this account is left in memory for the next one. */
export function signOut() {
  writeSession(null);
  location.reload();
}

/** Save the name, and a new password when one is given. Resolves to what went wrong, or "". */
export async function saveAccount(body: { name: string; current?: string; next?: string }) {
  const { user } = account.state;
  const result = user ? await updateAccount(user.id, body) : "Sign in on this device first.";
  if (typeof result === "string") return result;
  refreshSession(result);
  account.set({ user: result });
  return "";
}
