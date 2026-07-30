import { describe, expect, it } from "vitest";
import type { LngLat } from "./geo";
import { formatCoordLabel, planBuilderPoints, reorder } from "./route-builder";

const TORONTO: LngLat = [-79.38318, 43.65321];

describe("reorder", () => {
  it("moves an item up and down", () => {
    expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reorder(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("returns the same array reference when nothing moves", () => {
    // Lets the caller skip a re-render rather than replacing state with an
    // equal-but-different array.
    const list = ["a", "b"];
    expect(reorder(list, 1, 1)).toBe(list);
  });

  it("clamps a target past either end instead of dropping the item", () => {
    // The UI disables the buttons at the ends, but a clamp means a stray call
    // can never lose a stop.
    expect(reorder(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(reorder(["a", "b", "c"], 2, 99)).toEqual(["a", "b", "c"]);
    expect(reorder(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
  });

  it("ignores an out-of-range source", () => {
    expect(reorder(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(reorder(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });

  it("never changes length", () => {
    const list = ["a", "b", "c", "d"];
    for (let from = 0; from < list.length; from++) {
      for (let to = 0; to < list.length; to++) {
        expect(reorder(list, from, to)).toHaveLength(list.length);
      }
    }
  });
});

describe("formatCoordLabel", () => {
  it("renders lat, lng to five decimals", () => {
    // Latitude first: it reads as a map coordinate to a human, even though the
    // tuple is [lng, lat] internally.
    expect(formatCoordLabel(TORONTO)).toBe("43.65321, -79.38318");
  });

  it("round-trips through the input unchanged", () => {
    // The pin is only honoured while the field still reads exactly as the pin
    // left it, so the label has to be stable.
    const label = formatCoordLabel(TORONTO);
    expect(formatCoordLabel(TORONTO)).toBe(label);
  });
});

describe("planBuilderPoints", () => {
  const pin = { coord: TORONTO, label: formatCoordLabel(TORONTO) };

  it("refuses a build without both ends", () => {
    expect(planBuilderPoints("", [], "", null)).toEqual({
      ok: false,
      error: "Enter at least a start and an end.",
    });
    expect(planBuilderPoints("Union Station", [], "", null).ok).toBe(false);
  });

  it("geocodes every field when there is no pin", () => {
    const plan = planBuilderPoints("Union Station", ["Casa Loma"], "High Park", null);
    expect(plan).toEqual({
      ok: true,
      toGeocode: ["Union Station", "Casa Loma", "High Park"],
      pinnedStart: null,
    });
  });

  it("skips geocoding the start when the pin is still in the field", () => {
    const plan = planBuilderPoints(pin.label, [], "High Park", pin);
    expect(plan).toEqual({
      ok: true,
      toGeocode: ["High Park"],
      pinnedStart: TORONTO,
    });
  });

  it("drops the pin once the runner edits the start", () => {
    // THE CASE THAT MATTERS. Routing from a stale GPS fix because the text
    // changed underneath it would quietly build the wrong route — worse than
    // any geocode failure, because nothing looks broken.
    const plan = planBuilderPoints("Union Station", [], "High Park", pin);
    expect(plan).toEqual({
      ok: true,
      toGeocode: ["Union Station", "High Park"],
      pinnedStart: null,
    });
  });

  it("ignores blank stops", () => {
    const plan = planBuilderPoints("A", ["", "  ", "B"], "C", null);
    expect(plan).toEqual({ ok: true, toGeocode: ["A", "B", "C"], pinnedStart: null });
  });

  it("still builds when only the end is filled alongside a pin", () => {
    expect(planBuilderPoints(pin.label, [], "High Park", pin).ok).toBe(true);
    // ...but a pin with nothing else is not a route.
    expect(planBuilderPoints(pin.label, [], "", pin).ok).toBe(false);
  });
});
