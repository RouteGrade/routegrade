-- Run dimension, one row per recorded run.
--
-- `route_name` is intentionally omitted (user-editable free text, same policy
-- as `name` in dim_routes). `route_id` is a loose pointer: run history
-- survives saved-route deletion, so it may not match a row in dim_routes.
-- Pace prefers the client-reported average and falls back to a derivation
-- from duration/distance (null for zero-distance runs).

with runs as (
    select * from {{ ref('stg_runs') }}
),

users as (
    select * from {{ ref('dim_users') }}
)

select
    runs.run_id,
    runs.user_id,
    runs.route_id,
    (runs.route_id is not null)     as followed_saved_route,
    runs.distance_km,
    case
        when runs.distance_km < 3  then 'short (<3 km)'
        when runs.distance_km < 7  then 'medium (3-7 km)'
        when runs.distance_km < 12 then 'long (7-12 km)'
        else 'very long (12+ km)'
    end                             as distance_bucket,
    runs.duration_s,
    coalesce(
        runs.avg_pace_s_per_km,
        case
            when runs.distance_km > 0
            then cast(round(runs.duration_s / runs.distance_km) as integer)
        end
    )                               as pace_s_per_km,
    runs.started_at,
    cast(runs.started_at as date)   as run_date,
    users.signup_at
from runs
left join users on users.user_id = runs.user_id
