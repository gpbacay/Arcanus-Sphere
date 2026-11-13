"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useStore } from "@/shared/store";
import { Logo } from "@/shared/ui/logo";
import { passwordError, usernameError } from "./local";
import { account, enter, restoreAccount } from "./session";

const REMEMBERED = "arcanus_remembered_username";

/** Arcanus for whoever is signed in; the sign-in form until someone is. */
export function Gate({ children }: { children: ReactNode }) {
  const { user, ready } = useStore(account);
  useEffect(restoreAccount, []);
  if (!ready) return null;
  return user ? children : <SignIn />;
}

function SignIn() {
  const id = useId();
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; password?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  // "Remember me" also keeps the username here, filled in after signing out.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBERED);
      if (!saved) return;
      setUsername(saved);
      setRemember(true);
    } catch {
      /* storage blocked: nothing is remembered */
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = creating
      ? { username: usernameError(username), password: passwordError(password) }
      : { username: username.trim() ? "" : "Enter your username.", password: password ? "" : "Enter your password." };
    setErrors(found);
    if (found.username || found.password) return;
    setPending(true);
    const form = await enter(creating, { username, password, name, remember }).catch(() => "This browser could not save the account. Check that site storage is allowed.");
    if (!form) {
      try {
        if (remember || creating) localStorage.setItem(REMEMBERED, username.trim().toLowerCase());
        else localStorage.removeItem(REMEMBERED);
      } catch {
        /* storage blocked */
      }
      return; // signed in: the gate opens
    }
    setPending(false);
    setErrors({ form });
  }

  const field = (key: "username" | "password") => ({
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined,
  });
  const problem = (key: "username" | "password") =>
    errors[key] ? (
      <span id={`${id}-${key}-error`} className="signin-error">
        {errors[key]}
      </span>
    ) : null;

  return (
    <main className="signin">
      <div className="orb-fallback" data-loading aria-hidden />
      <form className="signin-pane" onSubmit={submit} noValidate>
        <h1>
          <Logo size={26} />
          Arcanus
        </h1>
        <p>{creating ? "Create an account on this device. Your Arcanus starts with its own memory, files and conversations." : "Sign in on this device."}</p>
        <label htmlFor={`${id}-username`}>Username</label>
        <input
          id={`${id}-username`}
          className="field"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={username}
          {...field("username")}
          onChange={(e) => setUsername(e.target.value)}
        />
        {problem("username")}
        {creating ? (
          <>
            <label htmlFor={`${id}-name`}>
              Name <span className="signin-optional">what Arcanus calls you · optional</span>
            </label>
            <input id={`${id}-name`} className="field" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </>
        ) : null}
        <label htmlFor={`${id}-password`}>Password</label>
        <span className="signin-password">
          <input
            id={`${id}-password`}
            className="field"
            type={shown ? "text" : "password"}
            autoComplete={creating ? "new-password" : "current-password"}
            value={password}
            {...field("password")}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="btn" aria-pressed={shown} onClick={() => setShown((v) => !v)}>
            {shown ? "Hide" : "Show"}
          </button>
        </span>
        {problem("password")}
        {creating ? null : (
          <label className="signin-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me
          </label>
        )}
        {errors.form ? (
          <p className="signin-error" role="alert">
            {errors.form}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Please wait" : creating ? "Create account" : "Sign in"}
        </button>
        <p className="signin-switch">
          {creating ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            onClick={() => {
              setCreating((v) => !v);
              setErrors({});
            }}
          >
            {creating ? "Sign in" : "Create an account"}
          </button>
        </p>
        <p className="signin-note">Accounts are kept in this browser and work offline. Nothing is sent anywhere.</p>
      </form>
    </main>
  );
}
