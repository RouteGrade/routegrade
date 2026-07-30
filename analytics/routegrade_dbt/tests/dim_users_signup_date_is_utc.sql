-- Singular test: signup_date must be the UTC calendar date of signup_at.
-- Returning any rows here fails the test.
--
-- Guards a specific regression. `signup_at` is timestamptz, and a bare
-- `cast(signup_at as date)` resolves against the SESSION TimeZone rather than
-- UTC — so the same signup lands on a different day depending on who runs dbt.
-- Measured 2026-07-30: a signup at 01:30 UTC is 2026-07-30 under a UTC session
-- and 2026-07-29 under America/Toronto. fct_daily_user_signups groups by this
-- column, so the drift would move rows between days in the fact table.
--
-- Note this only fires when dbt runs in a non-UTC session; under UTC the two
-- forms agree and the test passes either way. That is the point — it catches
-- the revert precisely in the environment where it would do damage.

select
    user_id,
    signup_at,
    signup_date
from {{ ref('dim_users') }}
where signup_date <> cast(signup_at at time zone 'UTC' as date)
