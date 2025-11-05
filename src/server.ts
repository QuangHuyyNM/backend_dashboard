import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

// Import all routers
import employeesRouter from "./routes/employees";
import studentsRouter from "./routes/students";
import coursesRouter from "./routes/courses";
import classesRouter from "./routes/classes";
import classStudentsRouter from "./routes/classStudents";
import attendanceRouter from "./routes/attendance";
import staffAttendanceRouter from "./routes/staffAttendance";
import leadsRouter from "./routes/leads";
import leaveRequestsRouter from "./routes/leaveRequests";
import payslipsRouter from "./routes/payslips";
import authRoutes from "./routes/auth";
import notificationsRouter from "./routes/notifications";
import { devBypass } from "./middlewares/devBypass";
import systemUsersRouter from "./routes/systemUsers";
import reportsRouter from "./routes/reports";
import recruitmentRoutes from "./routes/recruitment.routes";
import academicRouter from "./routes/academic";
import teachingLogsRouter from "./routes/teachingLogs";
import resourcesRouter from "./routes/resources";
import financeRouter from "./routes/finance";
import invoicesRouter from "./routes/invoices";
import paymentsRouter from "./routes/payments";
import qaRoutes from "./routes/qaRoutes";
import offersRouter from "./routes/offers";
import vouchersRouter from "./routes/vouchers";
import appointmentsRouter from "./routes/appointments";
import { startReminderWorker } from "./workers/reminderWorker";
import { requirePermission, verifyToken } from './middlewares/auth.middleware';
import expensesRouter from "./routes/expenses";
import settingsRouter from "./routes/settings";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Optional dev bypass: enable by setting SKIP_AUTH=true in .env (dev only)
if (process.env.SKIP_AUTH === "true") {
  // mount devBypass early so req.user is set for all routes in dev when SKIP_AUTH=true
  app.use(devBypass);
  console.info("[server] devBypass is ENABLED (SKIP_AUTH=true)");
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend API is running 🚀" });
});

// Simple auth mock (dev convenience): support both /signin and /login to match frontend usage
app.post("/api/auth/signin", (req, res) => {
  const { email, password } = req.body;
  if (email === "admin@local" && password === "admin") {
    const token = jwt.sign(
      { id: "RTE000", name: "Admin RTE", role: "CEO", permissions: ["VIEW_EMPLOYEES","VIEW_LEADS","EDIT_LEADS","VIEW_FINANCE"] },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "1h" }
    );
    return res.json({
      accessToken: token,
      user: { id: 1, name: "Admin RTE", email, role: "CEO", status: "ACTIVE" },
    });
  }
  return res.status(401).json({ message: "Invalid credentials" });
});

// alias /api/auth/login -> call same handler as /signin to avoid mismatch
app.post("/api/auth/login", (req, res, next) => {
  // forward to /api/auth/signin logic above
  // re-use by calling the signin handler via express internal routing
  req.url = "/api/auth/signin";
  // express won't re-run middleware chain automatically, so call the signin handler directly:
  // NOTE: simple approach: replicate signin logic (same as above)
  const { email, password } = req.body;
  if (email === "admin@local" && password === "admin") {
    const token = jwt.sign(
      { id: "RTE000", name: "Admin RTE", role: "CEO", permissions: ["VIEW_EMPLOYEES","VIEW_LEADS","EDIT_LEADS","VIEW_FINANCE"] },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "1h" }
    );
    return res.json({
      accessToken: token,
      user: { id: 1, name: "Admin RTE", email, role: "CEO", status: "ACTIVE" },
    });
  }
  return res.status(401).json({ message: "Invalid credentials" });
});

// Mount routers
// Important: ensure verifyToken runs BEFORE requirePermission so req.user exists
app.use('/api/employees', verifyToken, requirePermission('VIEW_EMPLOYEES'), employeesRouter);
app.use("/api/students", studentsRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/classes", classesRouter);
app.use("/api/class-students", classStudentsRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/staff-attendance", staffAttendanceRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/leave-requests", leaveRequestsRouter);
app.use("/api/payslips", payslipsRouter);
app.use("/api/auth", authRoutes);
app.use("/api/notifications", notificationsRouter);
app.use("/api/system-users", systemUsersRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/recruitments", recruitmentRoutes);
app.use("/api/academic", academicRouter);
app.use("/api/teaching-logs", teachingLogsRouter);
app.use("/api/finance", financeRouter);
app.use("/api/finance/invoices", invoicesRouter);
app.use("/api/finance/payments", paymentsRouter);
app.use("/api/qa", qaRoutes);
app.use("/api/admissions/offers", offersRouter);
app.use("/api/vouchers", vouchersRouter);
app.use("/api/admissions/appointments", appointmentsRouter);
app.use("/api/finance/expenses", expensesRouter);
app.use("/api/settings", settingsRouter);
startReminderWorker(1000 * 60 * 60);

// resources routes (aliases for compatibility)
app.use("/api/resources", resourcesRouter);
app.use("/api/files", resourcesRouter);
app.use("/api/settings/resources", resourcesRouter);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
