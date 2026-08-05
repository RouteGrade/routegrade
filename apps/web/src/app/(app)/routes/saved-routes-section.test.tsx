// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/authenticated-client";
import type { SavedRoute } from "@/lib/api/routes-client";

/**
 * The Routes tab's saved-route list — the last of the three account tabs to get
 * rendering coverage, closing the DOM-testing backlog row.
 *
 * `ApiError` is imported for real rather than mocked: the component branches on
 * `err instanceof ApiError`, so a stubbed class would make the 401 test pass
 * against a lie.
 */

const { listSavedRoutes, deleteSavedRoute } = vi.hoisted(() => ({
  listSavedRoutes: vi.fn(),
  deleteSavedRoute: vi.fn(),
}));

vi.mock("@/lib/api/routes-client", () => ({ listSavedRoutes, deleteSavedRoute }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { SavedRoutesSection } = await import("./saved-routes-section");

function route(partial: Partial<SavedRoute>): SavedRoute {
  return {
    id: "route-1",
    name: "Harbourfront loop",
    starting_address: null,
    distance_km: 5,
    preference: "quiet",
    activity: "run",
    geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    elevation_gain_m: 12,
    intersections_per_km: 3,
    score: 82,
    grade: "B",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T10:00:00Z",
    ...partial,
  };
}

beforeEach(() => {
  listSavedRoutes.mockReset();
  deleteSavedRoute.mockReset();
  listSavedRoutes.mockResolvedValue([]);
  deleteSavedRoute.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("SavedRoutesSection · load states", () => {
  it("shows the brand loader while fetching", () => {
    // Never resolves, so the loading state is the whole render.
    listSavedRoutes.mockReturnValue(new Promise(() => {}));
    render(<SavedRoutesSection />);

    const loader = screen.getByRole("progressbar", { name: "Loading your routes" });
    // Indeterminate: aria-valuenow must be absent, which is how a screen reader
    // is told the length is unknown.
    expect(loader.getAttribute("aria-valuenow")).toBeNull();
  });

  it("distinguishes an expired session from a failed load", async () => {
    listSavedRoutes.mockRejectedValue(new ApiError(401, "No active session"));
    render(<SavedRoutesSection />);

    expect(await screen.findByText(/session expired/i)).toBeTruthy();
    // The generic copy would send the runner debugging the wrong thing.
    expect(screen.queryByText(/couldn't load your saved routes/i)).toBeNull();
  });

  it("falls back to the generic message for anything that isn't a 401", async () => {
    listSavedRoutes.mockRejectedValue(new ApiError(500, "boom"));
    render(<SavedRoutesSection />);

    expect(await screen.findByText(/couldn't load your saved routes/i)).toBeTruthy();
    expect(screen.queryByText(/session expired/i)).toBeNull();
  });

  it("announces the load failure to assistive tech", async () => {
    // The delete error in this component has always been role="alert"; the load
    // error was a plain <p>, so a screen-reader user got silence on the failure
    // that matters more. Both are announced now.
    listSavedRoutes.mockRejectedValue(new ApiError(500, "boom"));
    render(<SavedRoutesSection />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't load your saved routes/i);
  });

  it("offers a way forward when nothing is saved", async () => {
    render(<SavedRoutesSection />);

    expect(await screen.findByText("Nothing saved")).toBeTruthy();
    const cta = screen.getByRole("link", { name: "Find a route" });
    expect(cta.getAttribute("href")).toBe("/");
  });
});

describe("SavedRoutesSection · the list", () => {
  it("shows each route's grade, name and stats, linked back to the map", async () => {
    listSavedRoutes.mockResolvedValue([
      route({ id: "abc", name: "Harbourfront loop", grade: "A", distance_km: 5.24 }),
    ]);
    render(<SavedRoutesSection />);

    const item = await screen.findByRole("listitem");
    expect(within(item).getByText("A")).toBeTruthy();
    expect(within(item).getByText("Harbourfront loop")).toBeTruthy();
    // Distance is rounded to one decimal for display.
    expect(within(item).getByText(/5\.2 km/)).toBeTruthy();
    expect(within(item).getByRole("link").getAttribute("href")).toBe("/?route=abc");
  });

  it("labels each delete button with the route it deletes", async () => {
    listSavedRoutes.mockResolvedValue([
      route({ id: "a", name: "Harbourfront loop" }),
      route({ id: "b", name: "Don Valley out-and-back" }),
    ]);
    render(<SavedRoutesSection />);

    // A bare "Delete" on every row is ambiguous the moment there are two.
    expect(
      await screen.findByRole("button", { name: "Delete Harbourfront loop" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Delete Don Valley out-and-back" }),
    ).toBeTruthy();
  });
});

describe("SavedRoutesSection · deleting", () => {
  it("drops the row on success without refetching the list", async () => {
    listSavedRoutes.mockResolvedValue([
      route({ id: "a", name: "Harbourfront loop" }),
      route({ id: "b", name: "Don Valley out-and-back" }),
    ]);
    render(<SavedRoutesSection />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Harbourfront loop" }),
    );
    // Local state filter, so the deleted row goes without a second round trip.
    expect(await screen.findByRole("button", { name: "Delete Don Valley out-and-back" }))
      .toBeTruthy();
    expect(screen.queryByText("Harbourfront loop")).toBeNull();
    expect(listSavedRoutes).toHaveBeenCalledTimes(1);
  });

  it("keeps the row and says so when the delete fails", async () => {
    listSavedRoutes.mockResolvedValue([route({ id: "a", name: "Harbourfront loop" })]);
    deleteSavedRoute.mockRejectedValue(new ApiError(500, "boom"));
    render(<SavedRoutesSection />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Harbourfront loop" }),
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    // Removing it optimistically and then failing would tell the runner their
    // route is gone when it is still on the server.
    expect(screen.getByText("Harbourfront loop")).toBeTruthy();
  });
});

/**
 * Founder request, 2026-08-05: routes split by activity type.
 *
 * The list is one library holding two kinds of route. A rider scrolling past
 * forty running routes to reach their three rides is the failure this block
 * guards, along with its opposite — a runner who has never ridden being shown a
 * filter with nothing on the other side of it.
 */
describe("SavedRoutesSection · activity", () => {
  it("names the activity on every row", async () => {
    listSavedRoutes.mockResolvedValue([
      route({ id: "a", name: "Lakeshore spin", activity: "ride", distance_km: 32 }),
    ]);
    render(<SavedRoutesSection />);

    const item = await screen.findByRole("listitem");
    // In the stats line, not only as an icon — an unlabelled glyph tells a
    // screen-reader user nothing about which routes are which.
    expect(within(item).getByText(/Ride/)).toBeTruthy();
  });

  it("reads a legacy route with no activity as a run", async () => {
    const legacy = route({ id: "old", name: "Old favourite" });
    delete (legacy as Partial<SavedRoute>).activity;
    listSavedRoutes.mockResolvedValue([legacy]);
    render(<SavedRoutesSection />);

    const item = await screen.findByRole("listitem");
    expect(within(item).getByText(/Run/)).toBeTruthy();
  });

  it("hides the filter until both activities are saved", async () => {
    listSavedRoutes.mockResolvedValue([
      route({ id: "a", activity: "run" }),
      route({ id: "b", activity: "run" }),
    ]);
    render(<SavedRoutesSection />);

    await screen.findAllByRole("listitem");
    // Three buttons where two do nothing, implying routes are being hidden.
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("offers the filter once a ride is saved alongside a run", async () => {
    listSavedRoutes.mockResolvedValue([
      route({ id: "a", name: "Morning 5k", activity: "run" }),
      route({ id: "b", name: "Lakeshore spin", activity: "ride" }),
    ]);
    render(<SavedRoutesSection />);

    expect(await screen.findByRole("radiogroup")).toBeTruthy();
    // Opens on All, so nothing is hidden until the runner asks for it.
    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("narrows the list to the chosen activity", async () => {
    listSavedRoutes.mockResolvedValue([
      route({ id: "a", name: "Morning 5k", activity: "run" }),
      route({ id: "b", name: "Lakeshore spin", activity: "ride" }),
      route({ id: "c", name: "Evening loop", activity: "run" }),
    ]);
    render(<SavedRoutesSection />);

    fireEvent.click(await screen.findByRole("radio", { name: "Ride" }));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText("Lakeshore spin")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Run" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("says which filter is hiding things rather than looking empty", async () => {
    // Reachable by deleting the last ride while the Ride filter is on. Without
    // this the runner sees a blank panel and assumes the routes were lost.
    listSavedRoutes.mockResolvedValue([
      route({ id: "a", name: "Morning 5k", activity: "run" }),
      route({ id: "b", name: "Lakeshore spin", activity: "ride" }),
    ]);
    render(<SavedRoutesSection />);

    fireEvent.click(await screen.findByRole("radio", { name: "Ride" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Lakeshore spin" }));

    expect(await screen.findByText(/No rides saved yet/)).toBeTruthy();
    // The library is not empty, so the "nothing saved" call to action is wrong.
    expect(screen.queryByText("Nothing saved")).toBeNull();
  });
});
