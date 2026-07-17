import RouteExplorer from "../components/route-explorer";
import { SessionNav } from "../components/session-nav";

export default function Home() {
  return (
    <main className="h-dvh w-full">
      <RouteExplorer sessionNav={<SessionNav />} />
    </main>
  );
}
