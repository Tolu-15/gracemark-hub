<<<<<<< HEAD
# Gracemark

## Run

```bash
npm install
npm start
```

Server runs at **`http://127.0.0.1:5502/`** — that URL is the login page (port **5502** avoids conflicting with Live Server on **5500**).

Do **not** open the repo-root `index.html` in the browser (it only redirects). Stop Live Server on port 5500 if you see “Redirecting to Gracemark login” with no sign-in form.

### Where is the login page?

| What | Path on disk | URL when using `npm start` |
|------|----------------|-----------------------------|
| Login **HTML** | `public/index.html` | `http://127.0.0.1:5502/` |
| Sign-in **JavaScript** | `public/js/student/login.js` | `/js/student/login.js` |

There is no `student/login/` folder for the page — only the JS module lives under `public/js/student/`.

## Supabase setup

### Fresh project (recommended if you hit many SQL errors)

Use this when the database was created from an old script, or `schema.sql` failed partway through.

1. In [Supabase Dashboard](https://supabase.com/dashboard), create a **new project** (empty database).
2. SQL Editor → run **`supabase/schema.sql`** (entire file, once).
3. SQL Editor → run **`supabase/rls.sql`** (entire file, once).
4. Do **not** run `patch_existing.sql` on a new project (only for upgrading an old DB).
5. Copy the new project **URL** and **anon key** into `public/supabase.js` (and `supabase.js` at repo root if you keep both in sync).
6. Copy **service role key** into `.env` (see below), then `npm start`.

### Upgrade an existing project

1. `supabase/schema.sql` (if tables are missing)
2. `supabase/rls.sql`
3. `supabase/patch_existing.sql` (legacy columns / app_settings grants)

### App config

1. Set `SUPABASE_URL` + `SUPABASE_ANON_KEY` in `public/supabase.js` (browser).
3. Copy `.env.example` to `.env` and add `SUPABASE_SERVICE_ROLE_KEY` from **Project Settings → API**. Restart `npm start`.  
   This enables `/api/admin/create-auth-user` so admins can add students and teachers without signup/email-confirm issues.

### First-time admin setup

1. Create your admin user in Supabase Auth (or sign up once).
2. Insert a row in `public.users` with `role = 'admin'` and matching `auth_id`.
3. Open **Admin → Dashboard**, set the current session, and save. This creates the default school record used when adding classes.

### Auth notes

- **Email not confirmed**: confirm the email or disable “Confirm email” under Auth → Providers → Email (dev only).
- **Permission denied on `app_settings`**: re-run `supabase/patch_existing.sql` (or the app_settings section in `rls.sql`).
- Student login uses admission number (e.g. `GMA1701`) or email; default password is `gracemark`.

### Role redirects

- `admin` → `/admin/dashboard/`
- `teacher` → `/teacher/dashboard/`
- `student` → `/student/dashboard/`

## URL style

All pages live under **`public/`** (Firebase hosting root). Routes are defined in **`public/routes.cjs`** and used by `server.js` and `firebase.json`.

| URL | Page |
|-----|------|
| `/` | Login (`public/index.html`) |
| `/admin/` | Admin entry → dashboard |
| `/admin/dashboard/` | Admin dashboard |
| `/admin/teachers/` | Manage teachers |
| `/admin/students/` | Manage students |
| `/admin/approvals/` | Result approvals |
| `/teacher/` | Teacher entry → dashboard |
| `/teacher/dashboard/` | Teacher dashboard |
| `/teacher/score-entry/` | Score entry |
| `/teacher/gradebook/` | Gradebook (legacy) |
| `/student/` | Student entry → dashboard |
| `/student/dashboard/` | Student results |

Edit HTML in **`public/`** only (copies at repo root are legacy). Assets: `/js/…`, `/assets/…`, `/shared/…` (site root is the `public/` folder on Firebase).
=======
# gracemark-hub
>>>>>>> 9d8e9903cefc529b9c45631c9ec3df6a9f97cb7d
