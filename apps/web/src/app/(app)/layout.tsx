import { AppShell } from "@/components/shell/app-shell";

/**
 * Shell for the four primary tabs (Run, Routes, Activity, You).
 *
 * `/login` and the `/auth/*` callbacks deliberately sit outside this group —
 * they are pre-app screens and must not render navigation into an app the
 * visitor hasn't entered yet.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
