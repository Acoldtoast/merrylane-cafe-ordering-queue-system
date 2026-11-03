import { Suspense } from "react";
import { LoginClient } from "./LoginClient";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="loading-block"><span className="spinner" />Loading…</div>}>
      <LoginClient />
    </Suspense>
  );
}
