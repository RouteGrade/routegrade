-- Daily route-score fact.
-- Grain: one row per (saved_date, grade).

with routes as (
    select * from {{ ref('dim_routes') }}
)

select
    saved_date,
    grade,
    count(*)              as routes_saved,
    avg(distance_km)      as avg_distance_km,
    avg(score)            as avg_score,
    avg(elevation_gain_m) as avg_elevation_gain_m
from routes
group by saved_date, grade
