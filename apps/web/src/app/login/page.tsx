import { redirect } from "next/navigation";
import { Logo } from "@/components/icons";
import { getSessionUser } from "@/lib/auth";
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

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <span className="shell-logo">
            <Logo size={22} />
          </span>
          <h1>Astronom</h1>
        </div>
        <p>Sign in with Google to run agents, store usage, and keep prompt traces.</p>
        {error ? <p className="login-error">{decodeURIComponent(error)}</p> : null}
        {configured ? (
          <form action="/auth/login" method="post">
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <button type="submit" className="btn primary login-google">
              Continue with Google
            </button>
          </form>
        ) : (
          <p className="note">
            Google login is off until <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set.
          </p>
        )}
      </div>
    </div>
  );
}
