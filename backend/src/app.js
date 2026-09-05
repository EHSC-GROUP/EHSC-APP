import express from "express";
import cors from "cors";

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

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

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
app.use("/api/business-development", businessDevelopmentRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large" });
  }
  if (err?.message?.includes("Only .jpg")) {
    return res.status(400).json({ error: err.message });
  }
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

export default app;
