-- Singular test: saved_date must be the UTC calendar date of saved_at.
-- Returning any rows here fails the test.
--
-- Same guard as dim_users_signup_date_is_utc, for the column
-- fct_route_scores_daily groups by. See that file for the measured example of
-- how far a session-timezone cast drifts.

select
    route_id,
    saved_at,
    saved_date
from {{ ref('dim_routes') }}
where saved_date <> cast(saved_at at time zone 'UTC' as date)
