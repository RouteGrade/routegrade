import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { EmailMagicLinkForm } from "@/components/auth/EmailMagicLinkForm";
import { RouteGradeMark } from "@/components/brand/route-grade-logo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/utils/safe-redirect";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next: rawNext, error } = await searchParams;

  // If already signed in, jump straight to the intended destination.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect(safeRedirect(rawNext, "/"));
  }

  // Route through the same open-redirect guard used for the actual redirects
  // below, rather than a separate, weaker inline check (the previous version
  // here didn't reject the "/\evil.com" backslash trick that safeRedirect
  // does). "/" isn't worth carrying as an explicit ?next= — it's the default.
  const validatedNext = rawNext ? safeRedirect(rawNext) : null;
  const next = validatedNext && validatedNext !== "/" ? validatedNext : undefined;

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-zinc-950 p-6">
      <section className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900/60 p-6 shadow-2xl shadow-black/60 backdrop-blur-xl">
        <header className="mb-6 flex items-center gap-3">
          <RouteGradeMark />
          <div>
            <h1 className="font-display text-lg font-bold tracking-tight text-white">
              Sign in to RouteGrade
            </h1>
            <p className="text-[11px] leading-tight text-zinc-400">
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

        <div className="my-5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          <span className="h-px flex-1 bg-white/10" />
          or
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <EmailMagicLinkForm next={next} />

        {/* A real POST, not a Link — the guest cookie is httpOnly and set
            server-side, and a plain "/" link would just bounce back here
            via the entry gate in proxy.ts without it. */}
        <form action="/auth/guest" method="POST" className="mt-6">
          {next && <input type="hidden" name="next" value={next} />}
          <button
            type="submit"
            className="flex h-9 w-full items-center justify-center rounded-lg text-xs font-semibold text-zinc-400 transition hover:text-zinc-200"
          >
            Continue as guest
          </button>
        </form>
      </section>
    </main>
  );
}
