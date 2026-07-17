-- Daily user-signup fact.
-- Grain: one row per (signup_date, auth_provider).

with users as (
    select * from {{ ref('dim_users') }}
)

select
    signup_date,
    auth_provider,
    count(*) as new_users
from users
group by signup_date, auth_provider
