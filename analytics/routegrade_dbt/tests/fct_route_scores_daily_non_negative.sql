-- Every daily grade bucket must have a positive count and sane averages.
select *
from {{ ref('fct_route_scores_daily') }}
where routes_saved <= 0
   or avg_distance_km <= 0
   or avg_score < 0
   or avg_score > 100
   or avg_elevation_gain_m < 0
