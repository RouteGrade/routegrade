import { RouteGradeSplash } from "@/components/brand/route-grade-loader";

/** Root-level fallback — covers /login and /account as well as a cold start. */
export default function Loading() {
  return <RouteGradeSplash />;
}
