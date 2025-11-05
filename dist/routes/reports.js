"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/reports.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const router = (0, express_1.Router)();
// Helper to ensure safe numeric
function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
/**
 * GET /reports/summary
 * Return an aggregated report used by "Báo cáo hợp nhất".
 */
router.get("/summary", async (_req, res) => {
    try {
        // 1) basic totals
        const [staffTotalsRows] = await db_1.default.query(`
      SELECT 
        COUNT(*) AS total_staff,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_staff,
        SUM(CASE WHEN status <> 'ACTIVE' THEN 1 ELSE 0 END) AS inactive_staff
      FROM employees
    `);
        const staffTotals = staffTotalsRows[0] || {};
        const totalStaff = toNumber(staffTotals.total_staff);
        const activeStaff = toNumber(staffTotals.active_staff);
        const inactiveStaff = toNumber(staffTotals.inactive_staff);
        const [studentsRows] = await db_1.default.query(`SELECT COUNT(*) AS total_students FROM students`);
        const totalStudents = toNumber((studentsRows[0] || {}).total_students);
        const [classesRows] = await db_1.default.query(`SELECT COUNT(*) AS total_classes FROM classes`);
        const totalClasses = toNumber((classesRows[0] || {}).total_classes);
        // 2) headcount by role
        const [byRoleRows] = await db_1.default.query(`
      SELECT role, COUNT(*) AS cnt
      FROM employees
      GROUP BY role
      ORDER BY cnt DESC
    `);
        const headcountByRole = byRoleRows.map((r) => ({ role: r.role, count: toNumber(r.cnt) }));
        // 3) new hires last 12 months
        const [hiresRows] = await db_1.default.query(`
      SELECT YEAR(start_date) AS year, MONTH(start_date) AS month, COUNT(*) AS cnt
      FROM employees
      WHERE start_date IS NOT NULL AND start_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY YEAR(start_date), MONTH(start_date)
      ORDER BY YEAR(start_date), MONTH(start_date)
    `);
        const newHiresByMonth = hiresRows.map(r => ({ year: toNumber(r.year), month: toNumber(r.month), count: toNumber(r.cnt) }));
        // 4) class utilization: enrolled vs max_students (uses class_students)
        const [classUtilRows] = await db_1.default.query(`
      SELECT c.class_code, c.course_id, c.max_students,
             COUNT(cs.student_id) AS enrolled
      FROM classes c
      LEFT JOIN class_students cs ON cs.class_code = c.class_code
      GROUP BY c.class_code, c.course_id, c.max_students
      ORDER BY enrolled DESC
      LIMIT 200
    `);
        // fetch course names for mapping (defensive)
        const courseIds = Array.from(new Set(classUtilRows.map((r) => r.course_id).filter(Boolean)));
        let courseMap = {};
        if (courseIds.length) {
            const [coursesRows] = await db_1.default.query(`SELECT id, name FROM courses WHERE id IN (${courseIds.map(() => "?").join(",")})`, courseIds);
            coursesRows.forEach((c) => courseMap[String(c.id)] = c.name);
        }
        const classUtilization = classUtilRows.map(r => ({
            classCode: r.class_code,
            courseId: r.course_id,
            courseName: courseMap[String(r.course_id)] || String(r.course_id),
            enrolled: toNumber(r.enrolled),
            capacity: toNumber(r.max_students) || 0,
            utilization: (toNumber(r.max_students) > 0) ? Math.round((toNumber(r.enrolled) / toNumber(r.max_students)) * 100) : 0,
        }));
        // 5) attendance summary (students)
        const [attRows] = await db_1.default.query(`
      SELECT status, COUNT(*) AS cnt
      FROM attendance
      GROUP BY status
    `);
        const attendanceCounts = {};
        attRows.forEach(r => attendanceCounts[String(r.status)] = toNumber(r.cnt));
        // staff attendance
        const [staffAttRows] = await db_1.default.query(`
      SELECT status, COUNT(*) AS cnt
      FROM staff_attendance
      GROUP BY status
    `);
        const staffAttendanceCounts = {};
        staffAttRows.forEach(r => staffAttendanceCounts[String(r.status)] = toNumber(r.cnt));
        // 6) leads by source & status
        const [leadsSourceRows] = await db_1.default.query(`SELECT source, COUNT(*) AS cnt FROM leads GROUP BY source ORDER BY cnt DESC`);
        const leadsBySource = leadsSourceRows.map(r => ({ source: r.source || "Unknown", count: toNumber(r.cnt) }));
        const [leadsStatusRows] = await db_1.default.query(`SELECT status, COUNT(*) AS cnt FROM leads GROUP BY status ORDER BY cnt DESC`);
        const leadsByStatus = leadsStatusRows.map(r => ({ status: r.status || "Unknown", count: toNumber(r.cnt) }));
        // 7) payroll totals by month (from payslips table if exists)
        const [payrollRows] = await db_1.default.query(`
      SELECT year, month, SUM(total_pay) AS total_pay
      FROM payslips
      GROUP BY year, month
      ORDER BY year, month
      LIMIT 36
    `).catch(() => [[]]);
        const payrollByMonth = (payrollRows || []).map(r => ({ year: toNumber(r.year), month: toNumber(r.month), total: Number(r.total_pay || 0) }));
        // 8) top expense (sum total payroll current month)
        const now = new Date();
        const curYear = now.getFullYear();
        const curMonth = now.getMonth() + 1;
        const payrollThisMonthTotal = (payrollByMonth.find(p => p.year === curYear && p.month === curMonth) || { total: 0 }).total || 0;
        // Build response
        res.json({
            totals: {
                totalStaff,
                activeStaff,
                inactiveStaff,
                totalStudents,
                totalClasses,
                payrollThisMonthTotal,
            },
            headcountByRole,
            newHiresByMonth,
            classUtilization,
            attendanceSummary: {
                students: attendanceCounts,
                staff: staffAttendanceCounts,
            },
            leadsBySource,
            leadsByStatus,
            payrollByMonth,
        });
    }
    catch (err) {
        console.error("reports/summary error:", err);
        res.status(500).json({ message: "Error building report", error: (err instanceof Error ? err.message : String(err)) });
    }
});
exports.default = router;
