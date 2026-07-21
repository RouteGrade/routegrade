-- Daily run activity fact.
-- Grain: one row per run_date (UTC date the run started).
--
-- avg_pace_s_per_km is duration-weighted (total seconds / total km), not a
-- mean of per-run paces; null on days where all recorded distance is zero.

with runs as (
    select * from {{ ref('dim_runs') }}
)

select
    run_date,
    count(*)                as runs_count,
    count(distinct user_id) as distinct_runners,
    sum(distance_km)        as total_distance_km,
    sum(duration_s)         as total_duration_s,
    case
        when sum(distance_km) > 0
        then cast(round(sum(duration_s) / sum(distance_km)) as integer)
    end                     as avg_pace_s_per_km
from runs
group by run_date
