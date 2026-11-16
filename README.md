# Gracemark Academy Result Portal

The portal uses Next.js App Router, TypeScript and Supabase. The sign-in page is at `/`. Administrator, teacher and student pages live under `src/app/admin`, `src/app/teacher` and `src/app/student`. API handlers live in `src/app/api`.

## Local development

Install the locked dependencies with `npm ci`. Set the Supabase project URL and public key using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Server-side handlers also require `SUPABASE_SERVICE_ROLE_KEY`. Keep the service key in the server environment. Use a separate development Supabase project with synthetic records when testing writes.

Run `npm run dev` and open `http://localhost:3000`. For a production build, run `npm run build`, then `npm start`. Vercel uses the Next.js framework configuration in `vercel.json`.

## Database setup and releases

The `supabase` directory includes alternative schema baselines, incremental migrations, one-off cleanup scripts and destructive test resets. Verify the database baseline and migration history before selecting scripts to apply. The numeric prefixes are not unique across every migration. Provision administrator accounts through the school's approved administrator workflow.

For the production-audit changes, validate migrations 042 and 043 in staging before releasing the application. Migration 043 creates the function used by score entry. See [the audit report](docs/production-audit.md) and [database policy inventory](docs/database-policy-inventory.md) for verification and known issues.

## Checks

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm audit` and `npm run build`. The test suite uses synthetic fixtures. The audit report describes the separate browser and PostgreSQL checks and their coverage.

Keep private academic workbooks outside `public/`. Files within that folder are downloadable without signing in.
