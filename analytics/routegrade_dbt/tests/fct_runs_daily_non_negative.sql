-- Every daily run row must have positive counts and sane totals.
select *
from {{ ref('fct_runs_daily') }}
where runs_count <= 0
   or distinct_runners <= 0
   or distinct_runners > runs_count
   or total_distance_km < 0
   or total_duration_s <= 0
   or (avg_pace_s_per_km is not null and avg_pace_s_per_km <= 0)
