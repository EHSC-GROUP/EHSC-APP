import "dotenv/config";

// Fail loudly and immediately if production is about to start in a state
// that would be a real security hole, rather than quietly running unsafe.
if (process.env.NODE_ENV === "production") {
  const missing = [];
  if (!process.env.CORS_ORIGIN) missing.push("CORS_ORIGIN (the deployed frontend's URL — open CORS in production lets any site call this API using a stolen token)");
  if (process.env.FIRESTORE_EMULATOR_HOST) missing.push("FIRESTORE_EMULATOR_HOST is set — remove it, production must use the real Firestore project");
  if (missing.length) {
    console.error("Refusing to start in production:\n" + missing.map((m) => ` - ${m}`).join("\n"));
    process.exit(1);
  }
}

const { default: app } = await import("./app.js");
const { startAttendancePruneJob } = await import("./lib/attendancePrune.js");

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`HR & Payroll API listening on http://localhost:${PORT}`);
  startAttendancePruneJob();
});
