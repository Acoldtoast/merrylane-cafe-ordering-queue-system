"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icons";

const accounts = [
  {
    role: "Administrator",
    email: "admin@merrylane.com",
    password: "admin123",
    name: "Mira Dela Cruz",
  },
  {
    role: "Staff",
    email: "barista@merrylane.com",
    password: "staff123",
    name: "Paolo Reyes",
  },
];

export function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") || "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async (overrideEmail?: string, overridePassword?: string) => {
    const loginEmail = overrideEmail ?? email;
    const loginPassword = overridePassword ?? password;
    if (!loginEmail || !loginPassword) {
      setError("Please enter your email and password.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          remember,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Those credentials don't match our records.");
      }

      const role = data.user?.role;
      if (role === "admin" || role === "staff") {
        localStorage.setItem(
          `merrylane:${role}:last-activity:${data.user.email}`,
          String(Date.now())
        );
      }
      if (role === "staff") {
        localStorage.setItem(
          `merrylane:staff:remember:${data.user.email}`,
          data.remember_for_today ? "true" : "false"
        );
      }
      const fallback = role === "admin" ? "/admin" : "/staff";
      const destination =
        nextPath && (nextPath.startsWith("/admin") || nextPath.startsWith("/staff"))
          ? role === "admin"
            ? nextPath
            : nextPath.startsWith("/admin")
              ? "/staff"
              : nextPath
          : fallback;

      try {
        router.prefetch(destination);
      } catch (error: unknown) {
        console.warn(`Could not prefetch destination "${destination}".`, error);
      }
      router.replace(destination);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not sign in. Please try again."
      );
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-visual">
        <Brand href="/" onDark />

        <div className="auth-visual-center">
          <h1>
            Where the
            <br />
            <em>warmth</em>
            <br className="auth-desktop-break" />
            {" "}happens.
          </h1>
          <p>
            One console for the counter, the kitchen, and the numbers behind every
            cup. Sign in to start your shift.
          </p>
          <div className="auth-art">
            <Image
              src="/merrylane-cafe-illustration.png"
              alt="Illustration of the Merrylane Cafe storefront"
              width={600}
              height={400}
            />
          </div>
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form">
          <div className="auth-form-head">
            <span className="eyebrow">Welcome back</span>
            <h2>Sign in.</h2>
            <p>Use your staff account to open the service or admin console.</p>
          </div>

          <form
            className="auth-form-body"
            onSubmit={(event) => {
              event.preventDefault();
              signIn();
            }}
          >
            {error && <div className="auth-error">{error}</div>}

            <div className="field">
              <label className="label" htmlFor="login-email">
                Email address
              </label>
              <div className="search-box">
                <Icon name="mail" />
                <input
                  id="login-email"
                  type="email"
                  className="input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@merrylane.com"
                  autoComplete="username"
                  required
                  aria-invalid={Boolean(error) && !email.trim()}
                />
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="login-password">
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="login-password"
                  type={show ? "text" : "password"}
                  className="input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  style={{ paddingRight: 44 }}
                  required
                  aria-invalid={Boolean(error) && !password}
                />
                <button
                  type="button"
                  onClick={() => setShow((current) => !current)}
                  aria-label={show ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    border: 0,
                    background: "transparent",
                    color: "var(--muted)",
                    display: "flex",
                    padding: 4,
                  }}
                >
                  <Icon name={show ? "eye-off" : "eye"} size={16} />
                </button>
              </div>
            </div>

            <div className="auth-form-row">
              <label className="checkline" style={{ fontSize: 9.5 }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Keep me signed in for today · staff only
              </label>
              <span>Merrylane team only</span>
            </div>

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner spinner-light" style={{ width: 15, height: 15 }} />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in <Icon name="arrow-right" className="icon-sm" />
                </>
              )}
            </button>
          </form>

          <div className="auth-demo">
            <p>Demo accounts · tap to fill</p>
            <div className="demo-accounts">
              {accounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="demo-account"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setError("");
                  }}
                >
                  <span className="avatar">
                    {account.name
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span style={{ flex: 1 }}>
                    <strong>{account.role}</strong>
                    <br />
                    {account.email} · {account.password}
                  </span>
                  <Icon name="arrow-right" size={13} />
                </button>
              ))}
            </div>
          </div>

          <div className="auth-back">
            <Link href="/">← Back to the cafe home</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
