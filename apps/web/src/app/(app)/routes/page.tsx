import { Screen, ScreenSection, SignedOut } from "@/components/shell/screen";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DrawRouteCard } from "./draw-route-card";
import { SavedRoutesSection } from "./saved-routes-section";

export const dynamic = "force-dynamic";

export default async function RoutesPage() {
  let isAuthenticated = false;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isAuthenticated = user !== null;
  } catch {
    // Supabase not configured — the tab still renders its signed-out state.
  }

  return (
    <Screen title="Routes">
      <DrawRouteCard />
      <ScreenSection label="Saved">
        {isAuthenticated ? (
          <SavedRoutesSection />
        ) : (
          <SignedOut
            next="/routes"
            body="Sign in to keep the routes you plan and draw, and pick them back up on any device."
          />
        )}
      </ScreenSection>
    </Screen>
  );
}
