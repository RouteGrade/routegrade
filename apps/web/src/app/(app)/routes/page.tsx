import { Screen, ScreenSection, SignedOut } from "@/components/shell/screen";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BuildRouteCard } from "./build-route-card";
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
      <BuildRouteCard />
      <ScreenSection label="Saved">
        {isAuthenticated ? (
          <SavedRoutesSection />
        ) : (
          <SignedOut
            next="/routes"
            body="Sign in to keep the routes you plan and build, and pick them back up on any device."
          />
        )}
      </ScreenSection>
    </Screen>
  );
}
