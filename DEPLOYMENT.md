# Deployment & Security Checklist — HR & Payroll Module

This covers what changed for security hardening, what's still outstanding, and the
steps to take this app from local dev to a real production deployment. Read it
top to bottom before going live.

## 1. Security hardening already in place

- **HTTP headers** — `helmet()` is applied to every response (X-Content-Type-Options,
  X-Frame-Options, HSTS, etc.). Its default Content-Security-Policy is disabled
  because this backend is a JSON API, not an HTML-rendering server; the CSP that
  matters is the one the frontend's own host sets.
- **Rate limiting** — every `/api/*` route: 600 requests / 15 min per IP. `/api/auth/login`
  additionally: 10 attempts / 15 min per IP, to slow down credential-stuffing /
  brute-force. Tune both in `backend/src/app.js` if they're too tight for your
  traffic pattern.
- **CORS** — restricted to the origin(s) listed in `CORS_ORIGIN` (comma-separated).
  Unset in local dev (any origin allowed, since the Vite dev server proxies `/api`
  same-origin anyway); **required** in production — `server.js` refuses to start
  without it.
- **JWT** — `JWT_SECRET` must be 32+ random characters or the server refuses to
  start. Tokens expire after `JWT_EXPIRES_IN` (default 8h).
- **Standard temporary password** — every new login (employee, admin, associate,
  and the seeded superadmin) starts with `Welcome@123` and is forced to change it
  at first sign-in. That password can no longer be re-chosen as the "new" password,
  so the forced change can't be a no-op. Until a person actually signs in and
  changes it, anyone who knows their User ID can log in as them — see §4.
- **File uploads** — validated by both extension *and* declared MIME type
  (`.jpg/.jpeg/.png/.webp/.pdf`, matching content-types only). Files are re-checked
  against the same allow-list again when served back, so even a pre-existing
  record with unexpected metadata can never be served as an executable/renderable
  type (`text/html`, SVG, etc.) — it falls back to `application/octet-stream` +
  `X-Content-Type-Options: nosniff`.
- **Route param validation** — every `:userId`-shaped route param is checked
  against the same ID shape used to generate one (`[A-Z0-9_-]{1,64}`) before it's
  used to build a Firestore document path, so malformed input (e.g. a stray `/`)
  gets a clean `400` instead of reaching the database layer.
- **Error responses** — an unexpected `500` in production never forwards the raw
  internal error message to the client (only deliberately-thrown, safe-to-show
  errors — bad input, not found, etc. — do). Controlled by `NODE_ENV=production`.
- **No client-side Firestore access** — the frontend never talks to Firestore or
  Storage directly; every request goes through this Express API, which is the
  single place authorization is enforced. There are no Firestore/Storage security
  rules to maintain because of this.
- **Secrets hygiene** — `.env`, `*serviceAccountKey*.json`, `*firebase-adminsdk*.json`
  are all gitignored. No credentials are hardcoded anywhere in the codebase
  (verified by grep as part of this hardening pass).

## 2. Before you deploy — required environment variables

Set these in `backend/.env` (or your platform's secret/env manager — don't commit
real values):

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | A fresh 32+ char random string. Generate: `openssl rand -base64 48`. **Do not reuse the local dev value.** |
| `CORS_ORIGIN` | The exact URL the frontend is served from, e.g. `https://hr.ehsconsultantsgroup.org` |
| `FIRESTORE_EMULATOR_HOST` | **Unset entirely.** Server refuses to start in production if this is set. |
| `FIREBASE_STORAGE_EMULATOR_HOST` | **Unset entirely.** |
| `FIREBASE_PROJECT_ID` | Your real Firebase/GCP project ID |
| `FIREBASE_STORAGE_BUCKET` | Your real Storage bucket |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service-account key JSON (or omit and rely on the platform's built-in service account — Cloud Run, GCE, etc.) |
| `COMPANY_NAME` / `COMPANY_ADDRESS` | Already set to EHS Consultants' details |

## 3. Deployment topology

The app is built to be served **behind one reverse proxy / one origin** — the
frontend calls `/api/...` as a relative path (see `frontend/src/api/client.js`
and `frontend/vite.config.js`'s dev proxy), and file downloads assume the API is
reachable at `<same-origin>/api`. The simplest, lowest-risk setup:

```
Browser → HTTPS (Nginx/Caddy/Cloud Load Balancer, TLS terminated here)
            ├─ /            → static frontend build (frontend/dist)
            └─ /api/*       → backend (Node/Express, port 5000 internally)
```

If you instead split the frontend and backend onto different domains, you must
also update the frontend to call an absolute API URL and set `CORS_ORIGIN`
accordingly — more moving parts, not recommended unless you have a specific
reason.

Steps:
1. `cd frontend && npm run build` → serve `frontend/dist/` as static files.
2. `cd backend && npm run start` under a process manager (`pm2`, `systemd`, or
   your platform's own process supervision — e.g. Cloud Run/App Engine handle
   this for you). **Do not** run `npm run dev` (the `--watch` flag) in production.
3. Put TLS termination in front of both (Let's Encrypt via Nginx/Caddy, or your
   platform's managed TLS). The app itself does not terminate HTTPS.
4. Run `node scripts/seed.js` once against the production Firestore project to
   create the superadmin login, then sign in immediately and change the password.

## 4. Go-live checklist (do these, in order)

- [ ] `JWT_SECRET` is a fresh, unique 32+ char value (not the dev one).
- [ ] `CORS_ORIGIN` is set to the real frontend URL.
- [ ] `NODE_ENV=production`.
- [ ] No `*_EMULATOR_HOST` vars are set.
- [ ] `node scripts/seed.js` run once against production; sign in as `SUPERADMIN`
      and change the password **immediately** — it starts as `Welcome@123`, a
      password this document (and the app's own UI) makes public knowledge.
- [ ] Every employee/admin/associate profile created before go-live has actually
      signed in and changed their password, or been told to do so on day one.
  Nobody's account should sit at the standard temporary password once real data
  is behind it.
- [ ] **Project-wise Reimbursement Costing stays OFF** (Settings → Feature Flags)
      unless you were explicitly told to enable it. This was a deliberate,
      repeatedly-confirmed instruction — verify the flag is still `false` in the
      production Firestore project before and after go-live; it does not
      inherit from local dev data.
- [ ] TLS/HTTPS is active end-to-end (no plain HTTP in production).
- [ ] A process manager restarts the backend on crash and on server reboot.
- [ ] Firestore backups are scheduled (see §6).
- [ ] `backend/.env` (or platform secrets) are not committed to git — double
      check `git status` before the first production push.

## 5. Known residual risks (accepted, not fixed in this pass — flagging for a decision)

- **`npm audit`**: 10 moderate-severity advisories remain, all transitive
  dependencies of `firebase-admin` (and one each in `exceljs`/`node-cron`'s `uuid`
  dependency). Fixing them requires major-version bumps (`firebase-admin` 12→14,
  `exceljs` 4→3 *downgrade* is not viable, `node-cron` 3→4) which are breaking
  changes needing their own regression pass across every Firestore/Storage/Excel/
  cron call site — deliberately deferred rather than rushed. Run `npm audit` in
  `backend/` periodically and schedule this upgrade separately.
- **JWT in localStorage** — the frontend stores the auth token in `localStorage`
  (`frontend/src/api/client.js`), not an HttpOnly cookie. This is simple and
  avoids CSRF handling, but means a successful XSS anywhere in the app could
  exfiltrate a session token. The app has no `dangerouslySetInnerHTML` and never
  renders user-supplied HTML (verified), which is the main mitigation currently
  in place. A cookie-based session would need CSRF protection added in exchange —
  a larger architectural change, not done here without being asked.
- **No centralized logging/monitoring** — errors currently go to `console.error`
  only. For production, wire up a log aggregator (Cloud Logging if hosted on GCP,
  or any hosted log drain) and consider an uptime/error-rate alert on `/api/health`.
- **No automated tests in CI** — this session's verification was manual scripted
  regression checks run against the live emulator, not a checked-in test suite.
  Consider adding one before further feature work, especially around the
  two-step approval / advance-wallet logic, which is the most state-sensitive
  part of the app.

## 6. Firestore backups

Firestore itself has no built-in automatic backup in the free tier. Set up
scheduled exports:

```bash
gcloud firestore export gs://<your-backup-bucket>/$(date +%Y%m%d) --project=<your-project-id>
```

Run this on a daily cron (Cloud Scheduler + Cloud Functions, or any external
scheduler with `gcloud` access). Payroll/HR data has no other recovery path if
the project is deleted or corrupted.

## 7. What was audited and is clean

- No hardcoded secrets/passwords/API keys anywhere in the codebase (grepped).
- No client-side Firebase SDK usage — all Firestore/Storage access goes through
  this backend, which enforces auth on every route.
- No `dangerouslySetInnerHTML` or other raw-HTML rendering in the frontend.
- Every file-serving route checks the caller is the record's owner or an admin
  before streaming a file.
