"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { adminNav, staffNav } from "@/components/portalNav";
import { clearPortalSessionCache } from "@/components/PortalShell";
import {
  notifyPortalDataChanged,
  prefetchPortalRouteData,
} from "@/lib/portalPrefetch";
import { preloadPortalRouteCode } from "@/lib/preloadPortalRouteCode";
import {
  removeBrowserStorageItem,
  setBrowserStorageItem,
} from "@/lib/browserStorage";

const accounts = [
  {
    role: "Administrator",
    username: "admin-merrylane",
    password: "admin123",
    name: "Kirsten Baromma",
  },
  {
    role: "Staff",
    username: "angelu-merrylane",
    password: "staff123",
    name: "Angelu Macaraig",
  },
];

export function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get("reason") || "";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loginFailure, setLoginFailure] = useState<{ attempts: number } | null>(
    null
  );
  const [error, setError] = useState(
    reason === "session_conflict"
      ? "You were signed out because your account was used on another device."
      : ""
  );
  const [loginNotice, setLoginNotice] = useState("");
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryCodeRequested, setRecoveryCodeRequested] = useState(false);
  const [recoveryCodeVerified, setRecoveryCodeVerified] = useState(false);
  const [recoveryResendSeconds, setRecoveryResendSeconds] = useState(0);
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
  const [showRecoveryConfirmation, setShowRecoveryConfirmation] =
    useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryAction, setRecoveryAction] = useState<
    "send" | "verify" | "reset" | null
  >(null);
  const recoveryBusy = recoveryAction !== null;
  const recoveryCodeInputRef = useRef<HTMLInputElement>(null);
  const newPasswordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRecovering || !recoveryCodeRequested) return;
    if (recoveryCodeVerified) {
      newPasswordInputRef.current?.focus();
    } else {
      recoveryCodeInputRef.current?.focus();
    }
  }, [isRecovering, recoveryCodeRequested, recoveryCodeVerified]);

  useEffect(() => {
    if (recoveryResendSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setRecoveryResendSeconds((seconds) => Math.max(0, seconds - 1)),
      1000
    );
    return () => window.clearTimeout(timer);
  }, [recoveryResendSeconds]);

  const warmPortal = useCallback(
    (
      area: "admin" | "staff",
      destination: string,
      includeNavigation = true
    ) => {
      const nav = area === "admin" ? adminNav : staffNav;
      const routes = includeNavigation
        ? [destination, ...nav.map((item) => item.href)]
        : [destination];
      for (const href of new Set(routes)) {
        try {
          router.prefetch(href);
        } catch (prefetchError: unknown) {
          console.warn(`Could not prefetch route "${href}".`, prefetchError);
        }
        void preloadPortalRouteCode(area, href);
        prefetchPortalRouteData(area, href);
      }
    },
    [router]
  );
  const [busy, setBusy] = useState(false);
  const loginInProgressRef = useRef(false);
  const initialVerifyControllerRef = useRef<AbortController | null>(null);

  // Only warm the destination before navigation; the portal warms the rest of
  // its sidebar after it is visible so a phone is not flooded during sign-in.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    initialVerifyControllerRef.current = controller;
    fetch("/api/auth/verify", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!active || loginInProgressRef.current) return;
        if (data.authenticated && data.user) {
          if (data.user.role === "admin") {
            warmPortal("admin", "/admin", false);
            router.replace("/admin");
          } else if (data.user.role === "staff") {
            warmPortal("staff", "/staff/payments", false);
            router.replace("/staff/payments");
          }
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Could not verify an existing login session.", error);
        }
      });
    return () => {
      active = false;
      controller.abort();
      if (initialVerifyControllerRef.current === controller) {
        initialVerifyControllerRef.current = null;
      }
    };
  }, [router, warmPortal]);

  const signIn = async (overrideUsername?: string, overridePassword?: string) => {
    if (loginInProgressRef.current) return;
    const loginUsername = overrideUsername ?? username;
    const loginPassword = overridePassword ?? password;
    if (!loginUsername || !loginPassword) {
      setError("Please enter your username and password.");
      return;
    }

    loginInProgressRef.current = true;
    initialVerifyControllerRef.current?.abort();
    setBusy(true);
    setError("");
    setLoginNotice("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (
          (response.status === 401 || response.status === 429) &&
          Number.isInteger(data.failed_attempts)
        ) {
          setLoginFailure({ attempts: data.failed_attempts });
        }
        throw new Error(data.error || "Those credentials don't match our records.");
      }

      setLoginFailure(null);
      setLoginNotice("");
      const role = data.user?.role;
      if (role !== "admin" && role !== "staff") {
        throw new Error("The account has an unsupported portal role.");
      }
      if (role === "staff") {
        notifyPortalDataChanged("/api/auth/login");
      }
      // Starting a fresh session: clear any leftover state for both roles so
      // switching accounts in the same browser never mixes sessions.
      clearPortalSessionCache();
      removeBrowserStorageItem(
        `merrylane:admin:last-activity:${data.user.email}`
      );
      removeBrowserStorageItem(
        `merrylane:staff:last-activity:${data.user.email}`
      );

      setBrowserStorageItem(
        `merrylane:${role}:last-activity:${data.user.email}`,
        String(Date.now())
      );
      const fallback = role === "admin" ? "/admin" : "/staff/payments";
      const destination = fallback;

      warmPortal(role, destination, false);
      try {
        router.replace(destination);
      } catch {
        setError(
          "Signed in, but could not open the console. Please try again."
        );
        loginInProgressRef.current = false;
        setBusy(false);
        return;
      }
      // Keep the sign-in spinner visible until the destination panel has
      // mounted and taken over the screen, so the transition never looks stuck.
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not sign in. Please try again."
      );
      loginInProgressRef.current = false;
      setBusy(false);
    }
  };

  const requestRecoveryCode = async () => {
    if (recoveryResendSeconds > 0) return;
    const accountUsername = username.trim();
    if (!accountUsername) {
      setRecoveryError("Enter the account username on the sign-in form first.");
      return;
    }

    setRecoveryAction("send");
    setRecoveryCodeRequested(false);
    setRecoveryCodeVerified(false);
    setRecoveryCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    setRecoveryError("");
    setRecoveryMessage("");
    try {
      const response = await fetch("/api/auth/password-recovery", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: accountUsername }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not send a recovery code.");
      }
      setRecoveryCodeRequested(true);
      setRecoveryMessage(data.message);
      const retryAfterSeconds = Number(data.retry_after_seconds);
      setRecoveryResendSeconds(
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.ceil(retryAfterSeconds)
          : 60
      );
    } catch (requestError: unknown) {
      setRecoveryError(
        requestError instanceof Error
          ? requestError.message
          : "Could not send a recovery code. Please try again."
      );
    } finally {
      setRecoveryAction(null);
    }
  };

  const verifyRecoveryCode = async () => {
    if (!/^\d{6}$/.test(recoveryCode)) {
      setRecoveryError("Enter the six-digit recovery code.");
      return;
    }

    setRecoveryAction("verify");
    setRecoveryError("");
    setRecoveryMessage("");
    try {
      const response = await fetch("/api/auth/password-recovery/verify", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code: recoveryCode }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "The recovery code is invalid or expired.");
      }
      setRecoveryCodeVerified(true);
      setRecoveryMessage(data.message);
    } catch (verificationError: unknown) {
      setRecoveryError(
        verificationError instanceof Error
          ? verificationError.message
          : "Could not verify the recovery code. Please try again."
      );
    } finally {
      setRecoveryAction(null);
    }
  };

  const resetPassword = async () => {
    if (!recoveryCodeVerified) return;
    if (newPassword !== confirmNewPassword) {
      setRecoveryError("The new passwords do not match.");
      return;
    }

    setRecoveryAction("reset");
    setRecoveryError("");
    setRecoveryMessage("");
    try {
      const response = await fetch("/api/auth/password-recovery", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          code: recoveryCode,
          password: newPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (data.error === "The recovery code is invalid or expired.") {
          setRecoveryCodeVerified(false);
        }
        throw new Error(data.error || "Could not reset the password.");
      }
      setIsRecovering(false);
      setPassword("");
      setRecoveryCode("");
      setRecoveryCodeRequested(false);
      setRecoveryCodeVerified(false);
      setRecoveryResendSeconds(0);
      setNewPassword("");
      setConfirmNewPassword("");
      setLoginFailure(null);
      setError("");
      setLoginNotice(data.message);
    } catch (resetError: unknown) {
      setRecoveryError(
        resetError instanceof Error
          ? resetError.message
          : "Could not reset the password. Please try again."
      );
    } finally {
      setRecoveryAction(null);
    }
  };

  const showRecoveryLink = (loginFailure?.attempts ?? 0) >= 5;

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
              loading="eager"
            />
          </div>
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form">
          <div className="auth-form-head">
            <h2>{isRecovering ? "Reset password." : "Sign in."}</h2>
            {isRecovering && (
              <p>
                We&apos;ll send a code to the recovery email saved in your
                account settings. Verify it first, then choose a new password.
              </p>
            )}
          </div>

          {isRecovering ? (
            <>
              <form
                className="auth-form-body"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (recoveryCodeVerified) {
                    void resetPassword();
                  } else {
                    void verifyRecoveryCode();
                  }
                }}
              >
                {recoveryError && (
                  <div className="auth-error" role="alert">
                    {recoveryError}
                  </div>
                )}
                {recoveryMessage && (
                  <div className="auth-success" role="status">
                    {recoveryMessage}
                  </div>
                )}

                {recoveryAction === "send" && (
                  <div className="auth-success" role="status">
                    Sending a code to the saved recovery email…
                  </div>
                )}

                {!recoveryCodeVerified ? (
                  <div className="field">
                    <label className="label" htmlFor="recovery-code">
                      Six-digit code
                    </label>
                    <input
                      id="recovery-code"
                      ref={recoveryCodeInputRef}
                      type="text"
                      className="input"
                      value={recoveryCode}
                      onChange={(event) =>
                        setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="\d{6}"
                      maxLength={6}
                      disabled={!recoveryCodeRequested || recoveryBusy}
                      required
                    />
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label className="label" htmlFor="new-password">
                        New password
                      </label>
                      <div className="password-input-control">
                        <input
                          id="new-password"
                          ref={newPasswordInputRef}
                          type={showRecoveryPassword ? "text" : "password"}
                          className="input"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          autoComplete="new-password"
                          minLength={6}
                          maxLength={128}
                          disabled={recoveryBusy}
                          required
                        />
                        <button
                          type="button"
                          className="password-input-toggle"
                          aria-label={
                            showRecoveryPassword ? "Hide password" : "Show password"
                          }
                          aria-pressed={showRecoveryPassword}
                          onClick={() =>
                            setShowRecoveryPassword((visible) => !visible)
                          }
                          disabled={recoveryBusy}
                        >
                          <Icon
                            name={showRecoveryPassword ? "eye-off" : "eye"}
                            size={18}
                          />
                        </button>
                      </div>
                    </div>
                    <div className="field">
                      <label className="label" htmlFor="confirm-new-password">
                        Confirm new password
                      </label>
                      <div className="password-input-control">
                        <input
                          id="confirm-new-password"
                          type={showRecoveryConfirmation ? "text" : "password"}
                          className="input"
                          value={confirmNewPassword}
                          onChange={(event) =>
                            setConfirmNewPassword(event.target.value)
                          }
                          autoComplete="new-password"
                          minLength={6}
                          maxLength={128}
                          disabled={recoveryBusy}
                          required
                        />
                        <button
                          type="button"
                          className="password-input-toggle"
                          aria-label={
                            showRecoveryConfirmation
                              ? "Hide password"
                              : "Show password"
                          }
                          aria-pressed={showRecoveryConfirmation}
                          onClick={() =>
                            setShowRecoveryConfirmation((visible) => !visible)
                          }
                          disabled={recoveryBusy}
                        >
                          <Icon
                            name={showRecoveryConfirmation ? "eye-off" : "eye"}
                            size={18}
                          />
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    recoveryBusy ||
                    !recoveryCodeRequested ||
                    (!recoveryCodeVerified && recoveryCode.length !== 6)
                  }
                >
                  {recoveryAction === "send"
                    ? "Sending code…"
                    : recoveryAction === "verify"
                      ? "Verifying code…"
                      : recoveryAction === "reset"
                      ? "Updating password…"
                      : recoveryCodeVerified
                        ? "Update password"
                        : "Verify code"}
                </button>
              </form>

              {recoveryCodeRequested && !recoveryCodeVerified && !recoveryBusy && (
                <div className="auth-form-row">
                  <button
                    type="button"
                    className="text-link"
                    disabled={recoveryResendSeconds > 0}
                    onClick={() => void requestRecoveryCode()}
                  >
                    {recoveryResendSeconds > 0
                      ? `Resend code in ${recoveryResendSeconds}s`
                      : "Resend code"}
                  </button>
                </div>
              )}
              {!recoveryCodeRequested && !recoveryBusy && (
                <div className="auth-form-row">
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => void requestRecoveryCode()}
                  >
                    Try sending the code again
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {loginNotice && (
                <div className="auth-success" role="status">
                  {loginNotice}
                </div>
              )}
              <form
                className="auth-form-body"
                onSubmit={(event) => {
                  event.preventDefault();
                  signIn();
                }}
              >
                {error && (
                  <div className="auth-error" role="alert">
                    {error}
                  </div>
                )}

                <div className="field">
                  <label className="label" htmlFor="login-username">
                    Username
                  </label>
                  <div className="search-box">
                    <Icon name="user" />
                    <input
                      id="login-username"
                      type="text"
                      className="input"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="admin-merrylane"
                      autoComplete="username"
                      required
                      aria-invalid={Boolean(error) && !username.trim()}
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
                {showRecoveryLink && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setIsRecovering(true);
                      setRecoveryCode("");
                      setRecoveryCodeRequested(false);
                      setRecoveryCodeVerified(false);
                      setRecoveryResendSeconds(0);
                      setNewPassword("");
                      setConfirmNewPassword("");
                      setRecoveryError("");
                      setRecoveryMessage("");
                      setError("");
                      void requestRecoveryCode();
                    }}
                  >
                    Forgot password?
                  </button>
                )}
              </form>

              <div className="auth-demo">
                <p>Demo accounts · tap to fill</p>
                <div className="demo-accounts">
                  {accounts.map((account) => (
                    <button
                      key={account.username}
                      type="button"
                      className="demo-account"
                      onClick={() => {
                        setUsername(account.username);
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
                        {account.username} · {account.password}
                      </span>
                      <Icon name="arrow-right" size={13} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="auth-back">
            <Link href="/" prefetch={false}>
              ← Back to the cafe home
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
