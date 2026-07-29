import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

/**
 * Host the native shell loads the dev server from, derived from the same
 * CAP_SERVER_URL that configures Capacitor — one variable, so the two can't
 * drift. A phone hitting `http://10.0.0.x:3000` is a cross-origin request as
 * far as the dev server is concerned, and Next blocks those by default; without
 * this the app fails to load on device with no obvious cause.
 */
function capacitorDevHost(): string[] {
  if (!process.env.CAP_SERVER_URL) return [];
  try {
    return [new URL(process.env.CAP_SERVER_URL).hostname];
  } catch {
    // A malformed URL is the developer's typo to fix, not a reason to refuse
    // to boot the dev server.
    return [];
  }
}

const nextConfig: NextConfig = {
  // Allow opening the dev server via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1", ...capacitorDevHost()],

  // Proxy authenticated FastAPI calls through the same Next.js origin.
  // The browser only ever talks to Next.js (already reachable through the
  // usual port forwarding); Next.js reaches FastAPI internally at API_URL.
  // This is the same shape production uses when FastAPI lives behind /api/.
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${API_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
