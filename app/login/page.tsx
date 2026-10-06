import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  const requiresUser = !!process.env.APP_ALLOWED_USERS?.trim();
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <LoginForm requiresUser={requiresUser} />
      </Suspense>
    </div>
  );
}
