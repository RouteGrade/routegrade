const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return Response.json(
        { status: "error", service: "routegrade-api" },
        { status: 502 },
      );
    }
    const body = await res.json();
    return Response.json(body);
  } catch {
    return Response.json(
      { status: "offline", service: "routegrade-api" },
      { status: 503 },
    );
  }
}
