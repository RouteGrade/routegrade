-- Staging view over the operational user_profiles table.
--
-- Deliberately drops `email` and `avatar_url`: neither is needed for analytics
-- and we don't want raw PII flowing into downstream marts. If you later need
-- email-derived analytics, hash it here in a dedicated column — never carry the
-- plaintext.

with source as (
    select * from {{ source('routegrade_ops', 'user_profiles') }}
)

select
    user_id,
    display_name,
    auth_provider,
    created_at,
    updated_at
from source
