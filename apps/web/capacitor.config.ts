import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell config.
 *
 * Two modes, chosen by whether CAP_SERVER_URL is set:
 *
 *   Development — `CAP_SERVER_URL=http://192.168.x.x:3000 npx cap sync ios`
 *     points the shell at the Next dev server on your LAN, so the iPhone runs
 *     the real server-rendered app with hot reload. This is the only mode that
 *     works before the auth refactor, because the app still needs a Next
 *     server for its server components.
 *
 *   Shipping — no env var, so the shell loads `webDir` from the bundle. That
 *     requires `output: "export"`, which requires moving Supabase auth out of
 *     server components. Until then this mode has nothing to load.
 *
 * `webDir` is Next's static-export directory. It is intentionally named now
 * even though nothing writes to it yet — the iOS project bakes the path in at
 * `cap add` time, and changing it later means regenerating the project.
 */
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.routegrade.app",
  appName: "RouteGrade",
  webDir: "out",

  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          // Only opt into cleartext for an actual http:// origin — a plain-HTTP
          // server on the LAN. A tunnelled https:// dev server does not need it,
          // and a shipping build (no CAP_SERVER_URL at all) never reaches here.
          ...(serverUrl.startsWith("http://") ? { cleartext: true } : {}),
        },
      }
    : {}),

  ios: {
    // Matches --color-canvas, so the gap behind the webview during rotation
    // and rubber-band scrolling is the app's own black rather than white.
    backgroundColor: "#0a0a0a",
    // The run screen draws its own metrics over the map and manages safe-area
    // insets itself; letting the webview inset would double them up.
    contentInset: "never",
  },
};

export default config;
