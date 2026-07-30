/**
 * Address suggestions for the planner search field.
 *
 * Deliberately no "use client" directive: this is plain `fetch` plus types, and
 * the route handler imports `PlaceSuggestion` from here so the two cannot drift.
 *
 * Note this does NOT go through `API_BASE` like the other clients. Suggestions
 * are served by the Next app's own `/api/geocode/suggest`, not by the FastAPI
 * service — see that handler for why. If the endpoint later moves to FastAPI,
 * this function is the only thing that needs to change.
 */

export type PlaceSuggestion = {
  id: string;
  /** Full address; becomes the field value once picked. */
  label: string;
  /** Leading component — the name or street line. */
  primary: string;
  /** Everything after it, shown dimmed underneath. */
  secondary: string;
  latitude: number;
  longitude: number;
};

export type SuggestOptions = {
  /** Bias results toward the runner, so nearby places rank first. */
  near?: { latitude: number; longitude: number } | null;
  /** Lets the caller cancel a request superseded by a newer keystroke. */
  signal?: AbortSignal;
};

/**
 * Returns [] rather than throwing for anything short of a programming error —
 * a geocoder hiccup should never interrupt typing, and the runner can always
 * submit free text instead of picking a suggestion.
 */
export async function suggestPlaces(
  query: string,
  { near, signal }: SuggestOptions = {},
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const params = new URLSearchParams({ q: trimmed });
  if (near) {
    params.set("lat", String(near.latitude));
    params.set("lon", String(near.longitude));
  }

  try {
    const response = await fetch(`/api/geocode/suggest?${params}`, { signal });
    if (!response.ok) return [];
    const body = (await response.json()) as { results?: PlaceSuggestion[] };
    return Array.isArray(body.results) ? body.results : [];
  } catch {
    // AbortError included: a superseded request has no result to report.
    return [];
  }
}
