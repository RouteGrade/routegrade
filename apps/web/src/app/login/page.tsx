import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { EmailMagicLinkForm } from "@/components/auth/EmailMagicLinkForm";
import { RouteGradeMark } from "@/components/brand/route-grade-logo";
import { AddToHomeScreenStep } from "@/components/pwa/add-to-home-screen";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/utils/safe-redirect";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next: rawNext, error } = await searchParams;

  // If already signed in, jump straight to the intended destination.
  //
  // Guarded like every other page that reaches for Supabase (the app shell,
  // Activity, Routes, You): `createSupabaseServerClient` throws outright when
  // the keys are absent, and an unguarded call here took the whole sign-in
  // screen down with it rather than the one feature that needed them. Nobody
  // can be signed in without Supabase, so the answer in that case is simply
  // "no user" — render the form.
  let signedIn = false;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = user !== null;
  } catch {
    // Supabase not configured — show the form rather than an error screen.
  }
  // Outside the try: redirect() signals by throwing, and catching that here
  // would swallow the redirect and render the login form to a signed-in user.
  if (signedIn) {
    redirect(safeRedirect(rawNext, "/"));
  }

  // Route through the same open-redirect guard used for the actual redirects
  // below, rather than a separate, weaker inline check (the previous version
  // here didn't reject the "/\evil.com" backslash trick that safeRedirect
  // does). "/" isn't worth carrying as an explicit ?next= — it's the default.
  const validatedNext = rawNext ? safeRedirect(rawNext) : null;
  const next = validatedNext && validatedNext !== "/" ? validatedNext : undefined;

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-canvas p-6">
      {/* Overlays this screen on a phone that could install the app, so the
          offer is the first thing a new visitor sees. Renders nothing on
          desktop, in the native shell, or once installed — see the component. */}
      <AddToHomeScreenStep />
      <section className="w-full max-w-sm rounded-card border border-hairline bg-surface p-6 shadow-2xl shadow-black/60">
        <header className="mb-6 flex items-center gap-3">
          <RouteGradeMark />
          <div>
            <h1 className="font-display text-lg font-bold tracking-tight text-ink">
              Sign in to RouteGrade
            </h1>
            <p className="text-[11px] leading-tight text-muted">
              Save preferences and revisit routes.
            </p>
          </div>
        </header>

        {error === "callback" && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
          >
            We couldn&apos;t finish signing you in. Please try again.
          </p>
        )}

        <GoogleSignInButton next={next} />

        <div className="my-5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-faint">
          <span className="h-px flex-1 bg-raised" />
          or
          <span className="h-px flex-1 bg-raised" />
        </div>

        <EmailMagicLinkForm next={next} />

        {/* A real POST, not a Link — the guest cookie is httpOnly and set
            server-side, and a plain "/" link would just bounce back here
            via the entry gate in proxy.ts without it. */}
        <form action="/auth/guest" method="POST" className="mt-6">
          {next && <input type="hidden" name="next" value={next} />}
          <button
            type="submit"
            className="flex h-9 w-full items-center justify-center rounded-lg text-xs font-semibold text-muted transition hover:text-ink"
          >
            Continue as guest
          </button>
        </form>
      </section>
    </main>
  );
}
