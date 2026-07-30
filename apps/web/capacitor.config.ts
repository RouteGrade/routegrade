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

  server: {
    // Bundled page shown when the web layer cannot be loaded at all — the dev
    // server is down, or the phone is offline on a build that points at a
    // deployed origin. Without it the webview stays blank and the app looks
    // frozen with nothing explaining why.
    errorPath: "offline.html",

    ...(serverUrl
      ? {
          url: serverUrl,
          // Only opt into cleartext for an actual http:// origin — a plain-HTTP
          // server on the LAN. A tunnelled https:// dev server does not need it,
          // and a shipping build (no CAP_SERVER_URL at all) never reaches here.
          ...(serverUrl.startsWith("http://") ? { cleartext: true } : {}),
        }
      : {}),
  },

  plugins: {
    SplashScreen: {
      // The native launch screen is a static image and cannot animate, so the
      // web layer paints its own animated splash over the top and calls
      // SplashScreen.hide() the moment it does (see `AppSplash`). That call is
      // the normal, fast path and is what makes the handoff seamless.
      //
      // `launchShowDuration` is purely a dead-man's switch. Only the web layer
      // can call hide(), so if the web layer never loads — dev server down,
      // phone offline — nothing dismisses the splash and the app hangs on the
      // logo forever. It also covers the `server.errorPath` page, so without
      // this cap the offline screen would render *underneath* the splash and
      // never be seen. Do not set launchAutoHide:false here again.
      launchAutoHide: true,
      launchShowDuration: 4000,
      backgroundColor: "#0a0a0a",
      // The web splash draws the mark; a system spinner next to it would read
      // as two competing loading indicators.
      showSpinner: false,
    },
  },

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
