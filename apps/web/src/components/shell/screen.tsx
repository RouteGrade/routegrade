import Link from "next/link";

/**
 * Layout primitives for the list-style tabs (Routes, Activity, You).
 *
 * The Run tab does not use these — it is a full-bleed map that owns its whole
 * region and renders its own floating chrome.
 */

/** A scrolling screen with a large display title, sized to the shell region. */
export function Screen({
  title,
  action,
  children,
}: {
  title: string;
  /** Optional trailing control rendered inline with the title. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-lg px-5 pb-8 pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <header className="mb-6 flex items-end justify-between gap-4">
          <h1 className="rg-display text-[40px] uppercase text-ink">{title}</h1>
          {action}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Section heading inside a screen. */
export function ScreenSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="rg-label mb-3">{label}</h2>
      {children}
    </section>
  );
}

/** Neutral empty/placeholder state with an optional call to action. */
export function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-card border border-dashed border-hairline-strong p-8 text-center">
      <p className="rg-display text-xl uppercase text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
        {body}
      </p>
      {cta && (
        <Link href={cta.href} className="rg-btn rg-btn-primary mt-5">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

/** Shown on account-backed tabs when nobody is signed in. */
export function SignedOut({ next, body }: { next: string; body: string }) {
  return (
    <EmptyState
      title="Sign in"
      body={body}
      cta={{ href: `/login?next=${encodeURIComponent(next)}`, label: "Sign in" }}
    />
  );
}
