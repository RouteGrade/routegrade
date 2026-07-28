import { Screen, SignedOut } from "@/components/shell/screen";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RunsSection } from "./runs-section";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
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
    <Screen title="Activity">
      {isAuthenticated ? (
        <RunsSection />
      ) : (
        <SignedOut
          next="/activity"
          body="Sign in to record your runs and build a history of everything you've covered."
        />
      )}
    </Screen>
  );
}
