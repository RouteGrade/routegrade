-- Singular test: signup counts must never be negative.
-- Returning any rows here fails the test.

select
    signup_date,
    auth_provider,
    new_users
from {{ ref('fct_daily_user_signups') }}
where new_users < 0
