import RouteExplorer from "../components/route-explorer";
import { SessionNav } from "../components/session-nav";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const routeParam = params.route;
  const savedRouteId = typeof routeParam === "string" ? routeParam : undefined;

  let isAuthenticated = false;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isAuthenticated = user !== null;
  } catch {
    // Supabase not configured — the public planner still works, just no saving.
  }

  return (
    <main className="h-dvh w-full">
      <RouteExplorer
        sessionNav={<SessionNav />}
        isAuthenticated={isAuthenticated}
        savedRouteId={savedRouteId}
      />
    </main>
  );
}
