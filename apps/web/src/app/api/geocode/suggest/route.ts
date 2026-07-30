import { NextResponse, type NextRequest } from "next/server";
import type { PlaceSuggestion } from "@/lib/api/geocode-suggest";

/**
 * Address suggestions for the planner's search field.
 *
 * Why this lives in the Next app rather than the FastAPI service, which already
 * owns geocoding: the API's `/v1/routes/geocode` is a resolve-one-address
 * endpoint (Nominatim `limit=1`) and returns a single point, which an
 * autocomplete list cannot use. Adding a list endpoint there is the tidier
 * long-term home — this handler is deliberately a thin, swappable shim so that
 * migration is a one-line change in `geocode-suggest.ts`.
 *
 * It must stay server-side regardless of where it lives: Nominatim's usage
 * policy requires an identifying User-Agent, which a browser cannot set.
 */

const GEOCODER_BASE_URL =
  process.env.GEOCODER_BASE_URL ?? "https://nominatim.openstreetmap.org";
const GEOCODER_USER_AGENT =
  process.env.GEOCODER_USER_AGENT ?? "RouteGrade/0.1 (routegrade-web)";

/** Below this, results are noise and the request is a waste of a rate-limit slot. */
const MIN_QUERY_LENGTH = 3;
const MAX_RESULTS = 5;

/**
 * Half-width of the preference box around the runner, in degrees (~55 km).
 * `bounded=0` keeps it a preference rather than a filter, so searching a city
 * you're planning to visit still works.
 */
const VIEWBOX_DEGREES = 0.5;

type NominatimPlace = {
  place_id?: number | string;
  osm_id?: number | string;
  lat?: string;
  lon?: string;
  display_name?: string;
};

function toSuggestion(place: NominatimPlace): PlaceSuggestion | null {
  const latitude = Number(place.lat);
  const longitude = Number(place.lon);
  const label = typeof place.display_name === "string" ? place.display_name : "";
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !label) {
    return null;
  }

  // Nominatim returns "Name, Street, Suburb, City, Region, Postcode, Country".
  // The first component is the useful headline; the rest disambiguates it.
  const [primary, ...rest] = label.split(", ");

  return {
    id: String(place.place_id ?? place.osm_id ?? `${latitude},${longitude}`),
    label,
    primary: primary || label,
    secondary: rest.join(", "),
    latitude,
    longitude,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [] });
  }

  const search = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(MAX_RESULTS),
  });

  // Bias toward the runner so "main st" surfaces the one they can run to.
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    search.set(
      "viewbox",
      [
        lon - VIEWBOX_DEGREES,
        lat + VIEWBOX_DEGREES,
        lon + VIEWBOX_DEGREES,
        lat - VIEWBOX_DEGREES,
      ].join(","),
    );
    search.set("bounded", "0");
  }

  try {
    const response = await fetch(`${GEOCODER_BASE_URL}/search?${search}`, {
      headers: { "User-Agent": GEOCODER_USER_AGENT },
      signal: AbortSignal.timeout(6000),
      // Identical prefixes get typed constantly; a short shared cache keeps
      // this well inside Nominatim's rate limit.
      next: { revalidate: 60 },
    });
    if (!response.ok) {
      return NextResponse.json({ results: [] }, { status: 502 });
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      return NextResponse.json({ results: [] }, { status: 502 });
    }

    const results = body
      .map((place) => toSuggestion(place as NominatimPlace))
      .filter((place): place is PlaceSuggestion => place !== null);

    return NextResponse.json({ results });
  } catch {
    // A geocoder outage must not break typing — the field stays usable and
    // the runner can still submit a free-text address.
    return NextResponse.json({ results: [] }, { status: 502 });
  }
}
