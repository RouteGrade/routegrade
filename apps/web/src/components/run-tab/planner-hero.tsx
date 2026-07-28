"use client";

import { useState } from "react";
import type { Preference } from "@/lib/api/routes-client";

/**
 * The Run tab's idle state: a full-bleed map with a search pill at the top and,
 * at the bottom, the run goal set in display type above one large primary
 * action — the Nike Run Club shape, adapted to RouteGrade's job of *finding*
 * a route before you run it.
 *
 * The parameters that used to fill an always-open form (distance, vibe) are
 * collapsed into a sheet behind the goal readout, so the map — the thing the
 * runner is actually reading — keeps the screen.
 *
 * Deliberately kept visible rather than moved into the sheet:
 * the address field and "Create your own route". Both are entry points people
 * arrive wanting, and burying an entry point behind a sheet costs more than the
 * screen space it saves.
 */

const PREFERENCES: { id: Preference; label: string; icon: React.ReactNode }[] = [
  {
    id: "quiet",
    label: "Quiet",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M11 5 6 9H2v6h4l5 4z" />
        <line x1="22" x2="16" y1="9" y2="15" />
        <line x1="16" x2="22" y1="9" y2="15" />
      </svg>
    ),
  },
  {
    id: "flat",
    label: "Flat",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M2 12h20" />
        <path d="M2 17h20" />
        <path d="M2 7h20" />
      </svg>
    ),
  },
  {
    id: "scenic",
    label: "Scenic",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
        <circle cx="19" cy="5" r="1" />
      </svg>
    ),
  },
];

const MIN_KM = 1;
const MAX_KM = 15;

export type PlannerHeroProps = {
  address: string;
  onAddressChange: (value: string) => void;
  onLocate: () => void;
  locating: boolean;
  distanceKm: number;
  onDistanceChange: (km: number) => void;
  preference: Preference;
  onPreferenceChange: (preference: Preference) => void;
  searching: boolean;
  onFind: (event: React.FormEvent) => void;
  onOpenBuilder: () => void;
  planError: string | null;
  apiOffline: boolean;
};

export function PlannerHero({
  address,
  onAddressChange,
  onLocate,
  locating,
  distanceKm,
  onDistanceChange,
  preference,
  onPreferenceChange,
  searching,
  onFind,
  onOpenBuilder,
  planError,
  apiOffline,
}: PlannerHeroProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const sliderProgress = ((distanceKm - MIN_KM) / (MAX_KM - MIN_KM)) * 100;
  const preferenceLabel =
    PREFERENCES.find((p) => p.id === preference)?.label ?? preference;

  return (
    <>
      {/* Search pill — the one input that stays on screen. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
        <form
          onSubmit={onFind}
          className="pointer-events-auto mx-auto flex h-14 max-w-md items-center gap-2 rounded-full border border-hairline bg-surface pl-4 pr-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-faint">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <input
            id="start-address"
            type="text"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="Nathan Phillips Square, Toronto"
            aria-label="Starting point"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={onLocate}
            disabled={locating}
            aria-label="Use my location"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-volt transition-colors hover:bg-raised disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-5 w-5 ${locating ? "animate-spin" : ""}`}>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
        </form>

        {apiOffline && (
          <p className="pointer-events-auto mx-auto mt-2 max-w-md rounded-full bg-danger-wash px-4 py-2 text-center text-xs font-semibold text-danger">
            Can&apos;t reach RouteGrade — routes may not load.
          </p>
        )}
      </div>

      {/* Goal + primary action. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center">
        <div className="pointer-events-none h-40 w-full bg-linear-to-t from-canvas via-canvas/80 to-transparent" />
        <div className="pointer-events-auto flex w-full flex-col items-center gap-5 bg-canvas px-5 pb-7">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={`Distance ${distanceKm.toFixed(1)} kilometres, ${preferenceLabel} route. Change`}
            className="-mt-2 flex flex-col items-center"
          >
            <span className="rg-metric text-[72px] leading-none text-ink">
              {distanceKm.toFixed(1)}
            </span>
            <span className="rg-label mt-2 flex items-center gap-1.5">
              KM · {preferenceLabel}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </button>

          <button
            type="button"
            onClick={onFind}
            disabled={searching}
            aria-label="Find routes"
            className="flex h-32 w-32 items-center justify-center rounded-full bg-volt transition active:scale-95 disabled:opacity-70"
          >
            {searching ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-9 w-9 animate-spin text-canvas">
                <path d="M21 12a9 9 0 1 1-6.2-8.56" />
              </svg>
            ) : (
              <span className="rg-display text-2xl uppercase text-canvas">Find</span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenBuilder}
            className="text-xs font-bold uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink"
          >
            Create your own route
          </button>

          {planError && (
            <p role="alert" className="text-center text-xs text-danger">
              {planError}
            </p>
          )}
        </div>
      </div>

      {sheetOpen && (
        <div className="absolute inset-0 z-40 flex flex-col">
          {/* The scrim is a sibling above the sheet rather than a full-bleed
              layer behind it, so its whole area — including its centre — is
              actually clickable instead of being covered by the panel. */}
          <button
            type="button"
            aria-label="Close route options"
            onClick={() => setSheetOpen(false)}
            className="flex-1 bg-canvas/70"
          />
          <div className="animate-rise-in rounded-t-[28px] border-t border-hairline bg-surface px-5 pb-7 pt-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="rg-display text-2xl uppercase text-ink">Your run</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rg-btn rg-btn-secondary h-10 px-5 text-xs"
              >
                Done
              </button>
            </div>

            <div className="mb-7">
              <div className="mb-3 flex items-baseline justify-between">
                <label htmlFor="distance" className="rg-label">
                  Distance
                </label>
                <span className="rg-metric text-3xl text-volt">
                  {distanceKm.toFixed(1)}
                  <span className="ml-1 text-base text-muted">km</span>
                </span>
              </div>
              <input
                id="distance"
                type="range"
                min={MIN_KM}
                max={MAX_KM}
                step={0.5}
                value={distanceKm}
                onChange={(e) => onDistanceChange(Number(e.target.value))}
                className="rg-slider"
                style={{ "--slider-progress": `${sliderProgress}%` } as React.CSSProperties}
              />
              <div className="mt-2 flex justify-between">
                <span className="rg-label">{MIN_KM} km</span>
                <span className="rg-label">{MAX_KM} km</span>
              </div>
            </div>

            <span className="rg-label mb-3 block">Vibe</span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Route preference">
              {PREFERENCES.map((option) => {
                const selected = preference === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onPreferenceChange(option.id)}
                    className={`flex h-20 flex-col items-center justify-center gap-2 rounded-control border text-xs font-bold uppercase tracking-wider transition-colors ${
                      selected
                        ? "border-volt bg-volt-wash text-volt"
                        : "border-hairline text-muted hover:border-hairline-strong hover:text-ink"
                    }`}
                  >
                    {option.icon}
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
