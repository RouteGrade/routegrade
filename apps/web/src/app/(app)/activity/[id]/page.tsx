import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Screen, SignedOut } from "@/components/shell/screen";
import { RunDetailView } from "./run-detail-view";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let isAuthenticated = false;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isAuthenticated = user !== null;
  } catch {
    // Supabase not configured — fall through to the signed-out state.
  }

  if (!isAuthenticated) {
    return (
      <Screen title="Run">
        <SignedOut
          next={`/activity/${id}`}
          body="Sign in to see this run."
        />
      </Screen>
    );
  }

  return <RunDetailView runId={id} />;
}
