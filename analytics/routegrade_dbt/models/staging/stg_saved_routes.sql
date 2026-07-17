-- Staging view over the operational saved_routes table.
--
-- Deliberately drops `starting_address` (PII — a typed home address) and
-- `geometry` (bulky JSONB with no aggregate analytical use). Neither may flow
-- into downstream marts. If spatial analytics are ever needed, derive coarse
-- features here (e.g. a rounded centroid) — never carry the raw trace.

with source as (
    select * from {{ source('routegrade_ops', 'saved_routes') }}
)

select
    id                            as route_id,
    user_id,
    name,
    cast(distance_km as numeric)  as distance_km,
    preference,
    cast(elevation_gain_m as numeric) as elevation_gain_m,
    cast(score as numeric)        as score,
    grade,
    created_at,
    updated_at
from source
