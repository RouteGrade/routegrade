-- Saved-route dimension, one row per saved route.
--
-- `name` is intentionally omitted (user-editable free text, same policy as
-- display_name in dim_users). Joins to dim_users bring in signup_at.

with routes as (
    select * from {{ ref('stg_saved_routes') }}
),

users as (
    select * from {{ ref('dim_users') }}
)

select
    routes.route_id,
    routes.user_id,
    routes.preference,
    routes.distance_km,
    case
        when routes.distance_km < 3  then 'short (<3 km)'
        when routes.distance_km < 7  then 'medium (3-7 km)'
        when routes.distance_km < 12 then 'long (7-12 km)'
        else 'very long (12+ km)'
    end                            as distance_bucket,
    routes.elevation_gain_m,
    routes.score,
    routes.grade,
    'osrm'                         as provider,
    routes.created_at              as saved_at,
    cast(routes.created_at as date) as saved_date,
    users.signup_at
from routes
left join users on users.user_id = routes.user_id
