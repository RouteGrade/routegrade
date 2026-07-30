"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  suggestPlaces,
  type PlaceSuggestion,
} from "@/lib/api/geocode-suggest";

/**
 * Address field with a Google-Maps-style suggestion list.
 *
 * Picking a suggestion hands its coordinates up as well as its label, so the
 * planner can skip re-geocoding the text — which is both a round trip faster
 * and immune to the geocoder resolving the same string to a different place
 * than the one the runner actually tapped.
 *
 * Typing after a pick clears the coordinates: the text no longer describes the
 * picked place, and silently planning from a stale point is worse than
 * geocoding the new text.
 */

/** Long enough that a fast typist issues one request per word, not per letter. */
const DEBOUNCE_MS = 250;

/** Below this, results are noise. Matches the server handler's floor. */
const MIN_QUERY_LENGTH = 3;

/**
 * Filled in by the locate button. Feeding it back to a geocoder returns
 * nothing useful, so it never triggers a lookup.
 */
const CURRENT_LOCATION_PREFIX = "Current location (";

export type AddressAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  onPick: (place: PlaceSuggestion) => void;
  /** Bias suggestions toward the runner's position when it's known. */
  near?: { latitude: number; longitude: number } | null;
  placeholder?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
};

export function AddressAutocomplete({
  value,
  onChange,
  onPick,
  near,
  placeholder,
  id,
  className,
  "aria-label": ariaLabel,
}: AddressAutocompleteProps) {
  const generatedId = useId();
  const inputId = id ?? `address-${generatedId}`;
  const listboxId = `${inputId}-listbox`;

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Set while a suggestion is being applied, so the resulting `value` change
  // doesn't immediately re-query for the text we just filled in.
  const suppressNextQuery = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const query = value.trim();
  const eligible =
    query.length >= MIN_QUERY_LENGTH && !query.startsWith(CURRENT_LOCATION_PREFIX);

  // Derived rather than stored. Clearing `suggestions`/`open` from inside the
  // effect below would be a synchronous setState in an effect body, which
  // cascades an extra render on every keystroke; leaving stale suggestions in
  // state and gating on `eligible` costs nothing and renders once.
  const listOpen = open && eligible && suggestions.length > 0;

  useEffect(() => {
    if (suppressNextQuery.current) {
      suppressNextQuery.current = false;
      return;
    }
    if (!eligible) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const results = await suggestPlaces(query, {
        near,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSuggestions(results);
      setActiveIndex(-1);
      setOpen(results.length > 0);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `near` is intentionally read but not depended on: it updates when a GPS
    // fix lands, and re-querying mid-typing on that would be gratuitous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, eligible]);

  // A tap outside dismisses the list. Pointerdown rather than click so the
  // list is gone before a tap on the map is interpreted.
  useEffect(() => {
    if (!listOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [listOpen]);

  function applySuggestion(place: PlaceSuggestion) {
    // The label we're about to write would otherwise look like fresh typing
    // and immediately re-query for the address we just resolved.
    suppressNextQuery.current = true;
    onChange(place.label);
    onPick(place);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!listOpen || suggestions.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Stop the caret jumping to either end of the text while navigating.
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const next = current + delta;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      // Only swallow Enter when a suggestion is highlighted; otherwise it must
      // still submit the form with whatever was typed.
      event.preventDefault();
      applySuggestion(suggestions[activeIndex]);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
        }
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={className}
      />

      {listOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 max-h-72 overflow-y-auto overscroll-contain rounded-card border border-hairline bg-surface py-1 shadow-2xl shadow-black/60"
        >
          {suggestions.map((place, index) => (
            <li
              key={place.id}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              // Pointerdown, not click: the input's blur would otherwise fire
              // first and close the list before the tap resolved.
              onPointerDown={(event) => {
                event.preventDefault();
                applySuggestion(place);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5 ${
                index === activeIndex ? "bg-raised" : ""
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 h-4 w-4 shrink-0 text-faint"
                aria-hidden="true"
              >
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">
                  {place.primary}
                </span>
                {place.secondary && (
                  <span className="block truncate text-[11px] text-muted">
                    {place.secondary}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
