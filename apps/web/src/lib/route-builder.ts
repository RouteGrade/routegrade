import type { LngLat } from "@/lib/geo";

/**
 * Pure helpers for the "create your own route" address builder.
 *
 * Extracted so the list manipulation and the decide-what-to-geocode rule can be
 * tested without a map, a network call, or a browser geolocation permission —
 * the three things that make the builder awkward to exercise by hand.
 */

/** Move `from` to index `to`, clamping both ends. Returns a new array. */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length) return list;
  const target = Math.min(Math.max(to, 0), list.length - 1);
  if (target === from) return list;

  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * How a GPS fix is shown in the start field.
 *
 * Coordinates rather than a reverse-geocoded street address: reverse geocoding
 * is another provider round trip that can fail or return something misleadingly
 * precise ("12 Front St" when the runner is on the pavement opposite), and the
 * label's only job is to be recognisable and to survive a round trip through
 * the input so we know the pin is still the one the runner picked.
 *
 * 5 decimal places is a little over a metre — finer than the GPS fix itself.
 */
export function formatCoordLabel([lng, lat]: LngLat): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export type PinnedStart = { coord: LngLat; label: string } | null;

export type BuilderPlan =
  | { ok: true; toGeocode: string[]; pinnedStart: LngLat | null }
  | { ok: false; error: string };

/**
 * Work out which builder fields need geocoding, and whether the start is
 * already a known point.
 *
 * The pin only counts while the start field still reads exactly as the pin left
 * it. The moment the runner edits that text they mean an address, not their old
 * location, and silently routing from a stale GPS fix would be worse than a
 * geocode failure — it would quietly build the wrong route.
 */
export function planBuilderPoints(
  startAddr: string,
  stops: string[],
  endAddr: string,
  pinnedStart: PinnedStart,
): BuilderPlan {
  const start = startAddr.trim();
  const rest = [...stops, endAddr].map((a) => a.trim()).filter(Boolean);

  if (!start || rest.length === 0) {
    return { ok: false, error: "Enter at least a start and an end." };
  }

  const pinIsCurrent = pinnedStart !== null && pinnedStart.label === start;
  return {
    ok: true,
    toGeocode: pinIsCurrent ? rest : [start, ...rest],
    pinnedStart: pinIsCurrent ? pinnedStart.coord : null,
  };
}
