import { redirect } from "next/navigation";
import { Logo } from "@/components/icons";
import { DEMO_LOGIN, ensureDemoUser, getSessionUser } from "@/lib/auth";
import { supabaseAuthEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const session = await getSessionUser();
  if (session) redirect("/");
  const { next, error } = await searchParams;
  const configured = supabaseAuthEnabled();
  if (configured) await ensureDemoUser();

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <span className="shell-logo">
            <Logo size={22} />
          </span>
          <h1>Astronom</h1>
        </div>
        {error ? <p className="login-error">{decodeURIComponent(error)}</p> : null}
        {configured ? (
          <>
            <form action="/auth/password" method="post" className="login-form">
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <label className="field">
                <span>Username</span>
                <input
                  name="username"
                  type="text"
                  autoComplete="username"
                  defaultValue={DEMO_LOGIN.username}
                  required
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  defaultValue={DEMO_LOGIN.password}
                  required
                />
              </label>
              <button type="submit" className="btn primary login-google">
                Sign in
              </button>
            </form>
            <p className="login-hint">
              Demo account: <code>{DEMO_LOGIN.username}</code> / <code>{DEMO_LOGIN.password}</code>
            </p>
            <div className="login-split">or</div>
            <form action="/auth/login" method="post">
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <button type="submit" className="btn login-google">
                Continue with Google
              </button>
            </form>
          </>
        ) : (
          <p className="note">
            Login is off until <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set.
          </p>
        )}
      </div>
    </div>
  );
}
