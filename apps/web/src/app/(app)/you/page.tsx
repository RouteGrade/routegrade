import { Screen, SignedOut } from "@/components/shell/screen";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { YouView } from "./you-view";

export const dynamic = "force-dynamic";

export default async function YouPage() {
  let isAuthenticated = false;
  try {
    const supabase = await createSupabaseServerClient();
    // getUser() revalidates against Supabase, unlike the unverified user object
    // returned by getSession().
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isAuthenticated = user !== null;
  } catch {
    // Supabase not configured — the tab still renders its signed-out state.
  }

  // Deliberately a signed-out panel rather than a redirect: this is a tab, and
  // bouncing someone off the app shell for tapping a tab is jarring.
  return (
    <Screen title="You">
      {isAuthenticated ? (
        <YouView />
      ) : (
        <SignedOut
          next="/you"
          body="Sign in to set your runner profile and sync your routes and runs."
        />
      )}
    </Screen>
  );
}
