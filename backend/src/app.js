import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import profileRoutes from "./routes/profiles.js";
import salaryStructureRoutes from "./routes/salaryStructures.js";
import documentRoutes from "./routes/documents.js";
import billRoutes from "./routes/bills.js";
import holidayRoutes from "./routes/holidays.js";
import settingsRoutes from "./routes/settings.js";
import leaveTypeRoutes from "./routes/leaveTypes.js";
import leaveRoutes from "./routes/leave.js";
import reimbursementRoutes from "./routes/reimbursements.js";
import payslipRoutes from "./routes/payslips.js";
import attendanceRoutes from "./routes/attendance.js";
import form22Routes from "./routes/form22.js";
import selfServiceRoutes from "./routes/selfService.js";
import businessDevelopmentRoutes from "./routes/businessDevelopment.js";
import companyProfileRoutes from "./routes/companyProfiles.js";
import projectRoutes from "./routes/projects.js";
import materialIndentRoutes from "./routes/materialIndents.js";
import advanceRoutes from "./routes/advances.js";
import { requireFeatureFlag } from "./lib/featureFlags.js";

const IS_PROD = process.env.NODE_ENV === "production";

const app = express();

// The app is served behind a reverse proxy in production (Nginx, Cloud Run,
// etc.) — this makes req.ip and the rate limiter use the real client IP from
// X-Forwarded-For instead of the proxy's own address.
app.set("trust proxy", 1);

app.use(helmet());
// This is a JSON API consumed by a separately-hosted SPA, not a page the
// browser renders itself, so helmet's default CSP (meant for HTML
// responses) is irrelevant here and only complicates the /api/*/pdf and
// /api/*/excel download endpoints. Turned off; the SPA sets its own CSP.
app.use(helmet.contentSecurityPolicy(false));

// CORS_ORIGIN is a comma-separated allow-list (e.g. the deployed frontend's
// URL). Unset in local dev, where the Vite dev server proxies /api and
// origin checks would otherwise get in the way; required in production —
// server.js refuses to start without it there (see below).
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: false,
}));

app.use(express.json({ limit: "2mb" }));

// Generous ceiling on every route (defense in depth against scripted abuse
// and accidental retry storms), plus a much tighter one on login — the
// route that actually needs brute-force protection.
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
}));
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a few minutes and try again." },
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/salary-structures", salaryStructureRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/leave-types", leaveTypeRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/reimbursements", reimbursementRoutes);
app.use("/api/payslips", payslipRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/form22", form22Routes);
app.use("/api/me", selfServiceRoutes);
// Behind the projectManagement flag — the whole PM suite ships disabled
// for the HR/Payroll go-live (see FEATURE_FLAG_DEFAULTS).
const pmGate = requireFeatureFlag("projectManagement");
app.use("/api/business-development", pmGate, businessDevelopmentRoutes);
app.use("/api/company-profiles", pmGate, companyProfileRoutes);
app.use("/api/projects", pmGate, projectRoutes);
app.use("/api/material-indents", materialIndentRoutes);
app.use("/api/advances", advanceRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large" });
  }
  if (err?.message?.includes("Only .jpg")) {
    return res.status(400).json({ error: err.message });
  }
  const status = err.status || 500;
  // Routes throw with an explicit `status` for expected, safe-to-show
  // errors (bad input, not found, etc). An unexpected 500 might carry a raw
  // driver/library error message — never forward that to the client in
  // production, where it could leak internal details.
  const message = status < 500 || !IS_PROD ? err.message || "Internal server error" : "Internal server error";
  res.status(status).json({ error: message });
});

export default app;
