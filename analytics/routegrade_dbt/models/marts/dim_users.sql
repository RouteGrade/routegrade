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
    created_at                                as signup_at,
    cast(created_at as date)                  as signup_date,
    updated_at                                as last_profile_updated_at
from users
