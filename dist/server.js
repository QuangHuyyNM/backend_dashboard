"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Import all routers
const employees_1 = __importDefault(require("./routes/employees"));
const students_1 = __importDefault(require("./routes/students"));
const courses_1 = __importDefault(require("./routes/courses"));
const classes_1 = __importDefault(require("./routes/classes"));
const classStudents_1 = __importDefault(require("./routes/classStudents"));
const attendance_1 = __importDefault(require("./routes/attendance"));
const staffAttendance_1 = __importDefault(require("./routes/staffAttendance"));
const leads_1 = __importDefault(require("./routes/leads"));
const leaveRequests_1 = __importDefault(require("./routes/leaveRequests"));
const payslips_1 = __importDefault(require("./routes/payslips"));
const auth_1 = __importDefault(require("./routes/auth"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const devBypass_1 = require("./middlewares/devBypass");
const systemUsers_1 = __importDefault(require("./routes/systemUsers"));
const reports_1 = __importDefault(require("./routes/reports"));
const recruitment_routes_1 = __importDefault(require("./routes/recruitment.routes"));
const academic_1 = __importDefault(require("./routes/academic"));
const teachingLogs_1 = __importDefault(require("./routes/teachingLogs"));
const resources_1 = __importDefault(require("./routes/resources"));
const finance_1 = __importDefault(require("./routes/finance"));
const invoices_1 = __importDefault(require("./routes/invoices"));
const payments_1 = __importDefault(require("./routes/payments"));
const qaRoutes_1 = __importDefault(require("./routes/qaRoutes"));
const offers_1 = __importDefault(require("./routes/offers"));
const vouchers_1 = __importDefault(require("./routes/vouchers"));
const appointments_1 = __importDefault(require("./routes/appointments"));
const reminderWorker_1 = require("./workers/reminderWorker");
const auth_middleware_1 = require("./middlewares/auth.middleware");
const expenses_1 = __importDefault(require("./routes/expenses"));
const settings_1 = __importDefault(require("./routes/settings"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Optional dev bypass: enable by setting SKIP_AUTH=true in .env (dev only)
if (process.env.SKIP_AUTH === "true") {
    // mount devBypass early so req.user is set for all routes in dev when SKIP_AUTH=true
    app.use(devBypass_1.devBypass);
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
        const token = jsonwebtoken_1.default.sign({ id: "RTE000", name: "Admin RTE", role: "CEO", permissions: ["VIEW_EMPLOYEES", "VIEW_LEADS", "EDIT_LEADS", "VIEW_FINANCE"] }, process.env.JWT_SECRET || "your-secret-key", { expiresIn: "1h" });
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
        const token = jsonwebtoken_1.default.sign({ id: "RTE000", name: "Admin RTE", role: "CEO", permissions: ["VIEW_EMPLOYEES", "VIEW_LEADS", "EDIT_LEADS", "VIEW_FINANCE"] }, process.env.JWT_SECRET || "your-secret-key", { expiresIn: "1h" });
        return res.json({
            accessToken: token,
            user: { id: 1, name: "Admin RTE", email, role: "CEO", status: "ACTIVE" },
        });
    }
    return res.status(401).json({ message: "Invalid credentials" });
});
// Mount routers
// Important: ensure verifyToken runs BEFORE requirePermission so req.user exists
app.use('/api/employees', auth_middleware_1.verifyToken, (0, auth_middleware_1.requirePermission)('VIEW_EMPLOYEES'), employees_1.default);
app.use("/api/students", students_1.default);
app.use("/api/courses", courses_1.default);
app.use("/api/classes", classes_1.default);
app.use("/api/class-students", classStudents_1.default);
app.use("/api/attendance", attendance_1.default);
app.use("/api/staff-attendance", staffAttendance_1.default);
app.use("/api/leads", leads_1.default);
app.use("/api/leave-requests", leaveRequests_1.default);
app.use("/api/payslips", payslips_1.default);
app.use("/api/auth", auth_1.default);
app.use("/api/notifications", notifications_1.default);
app.use("/api/system-users", systemUsers_1.default);
app.use("/api/reports", reports_1.default);
app.use("/api/recruitments", recruitment_routes_1.default);
app.use("/api/academic", academic_1.default);
app.use("/api/teaching-logs", teachingLogs_1.default);
app.use("/api/finance", finance_1.default);
app.use("/api/finance/invoices", invoices_1.default);
app.use("/api/finance/payments", payments_1.default);
app.use("/api/qa", qaRoutes_1.default);
app.use("/api/admissions/offers", offers_1.default);
app.use("/api/vouchers", vouchers_1.default);
app.use("/api/admissions/appointments", appointments_1.default);
app.use("/api/finance/expenses", expenses_1.default);
app.use("/api/settings", settings_1.default);
(0, reminderWorker_1.startReminderWorker)(1000 * 60 * 60);
// resources routes (aliases for compatibility)
app.use("/api/resources", resources_1.default);
app.use("/api/files", resources_1.default);
app.use("/api/settings/resources", resources_1.default);
const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
    console.log(`✅ Server started on http://localhost:${PORT}`);
});
