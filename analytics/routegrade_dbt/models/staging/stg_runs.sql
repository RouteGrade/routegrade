-- Staging view over the operational runs table.
--
-- Deliberately drops `path` (the recorded GPS trace — PII-adjacent location
-- data, same policy as saved_routes.geometry) and `splits` (bulky JSONB with
-- no aggregate analytical use at this grain). Neither may flow into
-- downstream marts. If split-level analytics are ever needed, unnest coarse
-- per-km durations here — never carry the raw trace.

with source as (
    select * from {{ source('routegrade_ops', 'runs') }}
)

select
    id                                 as run_id,
    user_id,
    route_id,
    route_name,
    started_at,
    cast(duration_s as integer)        as duration_s,
    cast(distance_km as numeric)       as distance_km,
    cast(avg_pace_s_per_km as integer) as avg_pace_s_per_km,
    created_at,
    updated_at
from source
