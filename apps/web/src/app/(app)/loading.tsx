import { RouteGradeSplash } from "@/components/brand/route-grade-loader";

/**
 * Shown while an (app) route segment streams in. The tab screens each do
 * server work (Supabase session, saved routes, run history), and without this
 * the native shell just holds the previous screen — or nothing at all on a
 * cold start — which reads as a hang.
 */
export default function Loading() {
  return <RouteGradeSplash label="Loading" />;
}
