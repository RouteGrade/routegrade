import { summarizeSplits } from "@/lib/activity";
import type { RunSplit } from "@/lib/api/runs-client";
import { formatDuration } from "@/lib/geo";

/**
 * Per-kilometre splits, plotted as deviation from the run's own average.
 *
 * Form: a real table with a mark in each row, not a chart beside a table. There
 * are only ever a handful of rows, every value matters, and the exact split is
 * what runners read — so nothing is gated behind a hover.
 *
 * Encoding: bars grow left (faster) or right (slower) from a centre line at the
 * run's average pace. **Polarity is carried by direction, not by colour**, which
 * keeps the whole chart on one hue instead of introducing a diverging pair. The
 * single quickest kilometre is emphasised in the accent, and carries a "Fastest"
 * label so the emphasis never depends on colour alone.
 */
export function SplitsChart({ splits }: { splits: RunSplit[] }) {
  const { rows, averageS } = summarizeSplits(splits);
  if (rows.length === 0) return null;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <p className="rg-label">Splits</p>
        <p className="rg-label">Avg {formatDuration(Math.round(averageS))}</p>
      </div>
      <p className="mb-4 text-[11px] text-faint">
        Bars show each kilometre against this run&apos;s average — left is
        faster, right is slower.
      </p>

      <table className="w-full border-collapse">
        <caption className="sr-only">
          Splits, as time and as deviation from the run average
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Kilometre</th>
            <th scope="col">Compared to average</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const faster = row.deltaS < 0;
            // Half the track is the largest deviation in either direction.
            const width = `${row.magnitude * 50}%`;
            const delta = Math.round(Math.abs(row.deltaS));
            return (
              <tr key={row.km}>
                <th
                  scope="row"
                  className="w-6 py-1 pr-3 text-left text-xs font-semibold tabular-nums text-muted"
                >
                  {row.km}
                </th>
                <td className="py-1">
                  <div className="relative h-3">
                    {/* The centre line is the run's average: a hairline one
                        shade off the surface, not a gridline of data weight. */}
                    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-hairline-strong" />
                    <div
                      className={`absolute top-1/2 h-2 -translate-y-1/2 ${
                        faster ? "rounded-l-full" : "rounded-r-full"
                      } ${row.fastest ? "bg-accent" : "bg-muted"}`}
                      style={
                        faster
                          ? { right: "50%", width }
                          : { left: "50%", width }
                      }
                    />
                  </div>
                </td>
                <td className="w-12 py-1 pl-3 text-right text-xs font-semibold tabular-nums text-ink">
                  {formatDuration(row.durationS)}
                </td>
                <td className="w-14 py-1 pl-2 text-right text-[11px] tabular-nums text-faint">
                  {row.fastest ? (
                    <span className="font-bold uppercase tracking-wider text-accent">
                      Fastest
                    </span>
                  ) : delta === 0 ? (
                    ""
                  ) : (
                    `${faster ? "−" : "+"}${delta}s`
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
