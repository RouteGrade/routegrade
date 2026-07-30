import type { MetadataRoute } from "next";

/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * This makes RouteGrade installable to the home screen on Android and (since
 * iOS 17.4) on iPhone. Installing gets us a real app icon, a standalone frame
 * with no Safari chrome, and a splash screen — but *not* background location.
 * A run tracked from an installed web app still stops recording the moment iOS
 * suspends the page (screen lock or app switch), so this is the planner and
 * dogfooding surface, not the shipping run tracker. See docs for the Capacitor
 * track that fixes that.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RouteGrade — Run routes, graded",
    short_name: "RouteGrade",
    description:
      "RouteGrade scores running routes for safety, comfort, and scenery so you can find your best run.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // The run screen is a portrait metric stack and the map fills the frame;
    // neither has a landscape layout, so don't let the OS offer one.
    orientation: "portrait",
    // Both match --color-canvas, so the status bar and splash screen are
    // seamless with the app's near-black background.
    theme_color: "#0a0a0a",
    background_color: "#0a0a0a",
    categories: ["health", "fitness", "sports", "navigation"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // The logo mark sits inside the middle ~65% of the square, so it
        // survives the circle/squircle crop Android applies to maskable icons.
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Start a run",
        short_name: "Run",
        url: "/",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Activity",
        short_name: "Activity",
        url: "/activity",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
