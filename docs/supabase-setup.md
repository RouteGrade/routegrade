# Supabase project setup for RouteGrade

RouteGrade MVP 2 authenticates users through Supabase Auth. This guide covers
the exact manual steps a developer must complete before the local stack can
sign a user in.

Secrets never live in this repository. Fill them into `.env.local`
(frontend) and `.env` (API) — both git-ignored.

## 1. Create or select the project

1. Log into <https://supabase.com>.
2. Create a new project — pick a region close to your users and choose a strong
   database password (needed for `DATABASE_URL`). Record both.
3. From **Project Settings → API**, record:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`
   - **Publishable / anon key** → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
     - This key is safe to expose in the browser. It is not the service-role
       key. RouteGrade does not use the service-role key anywhere.
4. From **Project Settings → Database → Connection string**, take the
   *transaction-pooled* URL and set it as `DATABASE_URL`. Use the SQLAlchemy
   driver prefix: `postgresql+psycopg://…`.
5. Confirm the project uses **asymmetric (RSA/EC) JWT signing keys** in
   **Authentication → JWT keys**. RouteGrade validates tokens via the JWKS
   endpoint and does not support symmetric algorithms.
6. Derive:
   - `SUPABASE_JWT_ISSUER=https://<project-ref>.supabase.co/auth/v1`
   - `SUPABASE_JWKS_URL=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`

## 2. Redirect URLs

In **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` (dev). Set your production origin later.
- **Additional redirect URLs**:
  - `http://localhost:3000/auth/callback`
  - `https://<production-domain>/auth/callback`

Any URL not in this list will be rejected by Supabase during OAuth / magic-link
callback, resulting in a redirect to `/login?error=callback`.

## 3. Google OAuth

RouteGrade uses Supabase's Google provider — Google credentials never touch the
frontend.

1. In Google Cloud Console, create an OAuth 2.0 Web Client.
2. **Authorized JavaScript origins**:
   - `http://localhost:3000`
   - `https://<production-domain>`
3. **Authorized redirect URIs**: use the Supabase-provided provider callback
   from **Authentication → Providers → Google** (usually
   `https://<project-ref>.supabase.co/auth/v1/callback`).
4. Copy the Google **Client ID** and **Client secret** into the Supabase Google
   provider settings and click **Enable**.
5. Test end-to-end:
   - A new Google account should create a row in `auth.users` and, after the
     RouteGrade UI provisions, a matching row in `public.user_profiles`.
   - Signing in again with the same Google account must not create duplicates.

## 4. Email magic links

1. **Authentication → Providers → Email**: enable the provider. Turn OFF
   the password sign-in method — RouteGrade only supports magic links.
2. Review the magic-link email template. The `{{ .ConfirmationURL }}` link
   should target one of the allow-listed redirect URLs above.
3. Supabase's development email sender is rate-limited and best-effort. Expect
   short delays and possible spam filtering. For production, configure a real
   SMTP provider in the Supabase project.
4. RouteGrade's `/login` page displays a neutral "Check your email" message
   regardless of whether the email is registered — do not weaken this in the
   UI.

## 5. Apply the RouteGrade migration

With `DATABASE_URL` set to the Supabase pooled connection string:

```bash
cd services/api
uv run alembic upgrade head
```

This creates `public.user_profiles` with the FK to `auth.users(id)`, TZ-aware
timestamps, and RLS enabled. See `services/api/alembic/versions/`.

## 6. dbt analytics access

For the operational database, dbt should read `public.user_profiles` and write
into an `analytics` schema. In production, grant a dedicated role:

```sql
create role routegrade_dbt login password '<generated-locally>';
grant usage on schema public to routegrade_dbt;
grant select on public.user_profiles to routegrade_dbt;
create schema if not exists analytics authorization routegrade_dbt;
```

dbt must **not** be granted access to the `auth` schema, `service_role`
credentials, or any secret used by FastAPI. See
`analytics/routegrade_dbt/README.md`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Redirect mismatch page from Supabase | The `/auth/callback` URL isn't in the allow-list under **URL Configuration**. |
| `/login?error=callback` | Missing or expired `code` in the callback, or `exchangeCodeForSession` failed. Try again. |
| FastAPI 401 `Invalid token issuer` | `SUPABASE_JWT_ISSUER` does not match the token's `iss` claim exactly. |
| FastAPI 401 `Unknown token signing key` | The project has symmetric-only JWTs, or the JWKS endpoint is unreachable. |
| CORS error in the browser | Add the origin to `CORS_ORIGINS` in the API `.env`. |
| Magic-link email never arrives | Development SMTP is best-effort; configure a real provider or check spam. |
| `alembic upgrade` permission denied | The pooled connection lacks DDL rights; use a direct `postgres` role or the Supabase-provided admin URL for migrations. |
