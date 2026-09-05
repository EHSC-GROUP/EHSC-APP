# HR & Payroll Management App

Standalone single-company HR & Payroll web app — Super Admin console + Employee self-service portal.

- **Backend**: Node.js + Express (routers-per-feature under `backend/src/routes/`), JWT auth, Firestore (via `firebase-admin`), Firebase Storage for uploads, `pdfkit` for payslip/Form 22 PDFs, `exceljs` for the payroll register.
- **Frontend**: React 18 + Vite + React Router v6, plain CSS (no UI framework).
- **Database**: Firestore, run locally via the Firebase Emulator Suite (no cloud project needed for local dev).

## Prerequisites

- Node.js 18+
- Java (JDK 11+) — required by the Firestore emulator only. Not needed in production if you later point this at a real Firebase project.
- Firebase CLI: `npm install -g firebase-tools`

## First-time setup

```bash
# 1. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 2. Configure the backend
cd ../backend
cp .env.example .env
# Edit .env: set JWT_SECRET to a long random string, and COMPANY_NAME/COMPANY_ADDRESS
# for the payslip/Form 22 PDF header. The Firebase emulator vars are already
# set to sensible local defaults.
```

## Running locally

Three processes, each in its own terminal, from the project root unless noted:

```bash
# Terminal 1 — Firestore + Storage emulators
firebase emulators:start --only firestore,storage
# Emulator UI: http://localhost:4000

# Terminal 2 — backend API (from backend/)
cd backend
npm run dev
# API: http://localhost:5000

# Terminal 3 — frontend (from frontend/)
cd frontend
npm run dev
# App: http://localhost:5173 (proxies /api to the backend)
```

On first run, seed a Super Admin account and default settings (weekly-off = Sunday, earnings formula = 50% Basic / 20% HRA):

```bash
cd backend
node scripts/seed.js
```

This prints a one-time login: `SUPERADMIN` / `ChangeMe123!` (or set `SEED_SUPERADMIN_ID` / `SEED_SUPERADMIN_PASSWORD` env vars before running). You'll be forced through a password change on first login.

Open **http://localhost:5173** and sign in.

## Moving off the emulator later

To point at a real Firebase project instead of the emulator: create a service account key, remove the `FIRESTORE_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` vars from `backend/.env`, set `FIREBASE_PROJECT_ID`/`FIREBASE_STORAGE_BUCKET` to the real project, and set `GOOGLE_APPLICATION_CREDENTIALS` to the key file path (or use Application Default Credentials). No code changes needed — `firebase-admin` picks up the emulator vars automatically when present and talks to the real project when they're absent.

## Business Development module

A lead/enquiry tracker for the firm's consulting pipeline, separate from the HR/payroll features — it's the first item in the Super Admin nav. One enquiry record holds the client, how they were approached, and the discussion outcome; a running **action log** (not a single flat field) tracks follow-ups over time — each entry has a description, an employee assignment, a start date, a due date, and a completed checkbox, so progress on an enquiry is visible as a timeline rather than a single overwritten status. `result` covers the four outcomes requested (Purchase Order Received / Contract Accepted / Enquiry On Hold / Enquiry Dropped) plus an "In Progress" default. Enquiry numbers (`ENQ-0001`, ...) are generated server-side from a transactional counter. Backend: `backend/src/routes/businessDevelopment.js`. Frontend: `frontend/src/pages/Admin/BusinessDevelopment.jsx`.

## Notable design decisions (see spec gaps this rebuild resolved)

- **Employee delete = archive, not hard delete.** `DELETE /api/profiles/:userId` disables login but keeps all HR/payroll/leave history for audit purposes, rather than cascading deletes or leaving orphaned records.
- **Payslip edits after FINALIZED/PUBLISHED require an explicit "un-finalize"/"unpublish" step** (`POST /:userId/:period/unfinalize`, `.../unpublish`) rather than silently allowing edits to finalized numbers.
- **Leave type `carryForward` is fully implemented**, not just a stored flag: unused days from the immediately preceding financial year are snapshotted into the new year's opening entitlement the first time that leave type is touched.
- **`esiNumber`/`uan`** have real inputs in the Employee Profile editor and are wired into the Form 22 export.
- **Number-to-words** (reimbursement/payslip amounts) is one algorithm, ported once to `frontend/src/lib/numberToWords.js` for live preview; the server (`backend/src/lib/numberToWords.js`) always computes the authoritative stored value.
- **Role-string comparisons** all go through the single `ROLES` constant in `backend/src/lib/constants.js` — no repeated string literals.
- **"My Payslips"** self-service page added, since `PUBLISHED` payslips otherwise had no employee-facing view.

## Project structure

```
backend/
  src/
    config/firebase.js       # firebase-admin init (emulator-aware)
    lib/                     # business logic: payroll computation, leave balances,
                              # calendar/working-days, earnings formula, PDF/Excel builders
    middleware/               # JWT auth, multer upload config
    routes/                   # one router per feature, mounted in app.js
  scripts/seed.js             # creates the initial Super Admin + default settings
frontend/
  src/
    pages/Admin/               # Super Admin console pages
    pages/Employee/             # Self-service portal pages
    components/, context/, layouts/, lib/, api/
```
