import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // Allow opening the dev server via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],

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
