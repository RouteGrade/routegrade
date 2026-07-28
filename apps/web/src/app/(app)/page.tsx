import RouteExplorer from "@/components/route-explorer";
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
  // The Routes tab links here with ?build=1 to open the route builder directly.
  const startInBuilderMode = params.build === "1";

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

  // h-full, not h-dvh: the app shell already sized this region to the space
  // above the tab bar, and h-dvh here would push the map under it.
  return (
    <main className="h-full w-full">
      <RouteExplorer
        isAuthenticated={isAuthenticated}
        savedRouteId={savedRouteId}
        startInBuilderMode={startInBuilderMode}
      />
    </main>
  );
}
