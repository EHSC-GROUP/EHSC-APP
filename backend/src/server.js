import "dotenv/config";
import app from "./app.js";
import { startAttendancePruneJob } from "./lib/attendancePrune.js";

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`HR & Payroll API listening on http://localhost:${PORT}`);
  startAttendancePruneJob();
});
