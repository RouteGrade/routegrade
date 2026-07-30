-- User dimension, one row per RouteGrade user.
--
-- display_name is intentionally omitted: no current analytical use justifies
-- carrying user-editable text into a mart. Add it back deliberately, with a
-- documented reason, if a product-analytics need appears.

with users as (
    select * from {{ ref('stg_user_profiles') }}
)

select
    user_id,
    auth_provider,
    created_at                                          as signup_at,
    -- UTC-explicit on purpose. `created_at` is timestamptz, and a bare
    -- `cast(... as date)` resolves it against the SESSION TimeZone — so the
    -- same signup lands on a different day depending on who runs dbt. Measured
    -- 2026-07-30: a signup at 01:30 UTC is 2026-07-30 under a UTC session and
    -- 2026-07-29 under America/Toronto. Since fct_daily_user_signups groups by
    -- this column, that made the fact table's grain depend on the operator.
    cast(created_at at time zone 'UTC' as date)         as signup_date,
    updated_at                                          as last_profile_updated_at
from users
