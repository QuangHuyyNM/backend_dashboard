"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// backend/src/routes/academic.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const router = (0, express_1.Router)();
// GET /api/academic/classes
router.get('/classes', async (req, res) => {
    try {
        const [classes] = await db_1.default.query(`SELECT c.class_code, c.course_id, c.teacher_id, c.ta_id, c.schedule, c.max_students, c.status,
              co.name as course_name,
              e.name as teacher_name
       FROM classes c
       LEFT JOIN courses co ON co.id = c.course_id
       LEFT JOIN employees e ON e.id = c.teacher_id
       ORDER BY c.class_code`);
        const [classStudentRows] = await db_1.default.query(`SELECT cs.class_code, s.id as student_id, s.name as student_name, s.profile_picture_url
       FROM class_students cs
       JOIN students s ON s.id = cs.student_id`);
        const studentsByClass = {};
        for (const r of classStudentRows) {
            if (!studentsByClass[r.class_code])
                studentsByClass[r.class_code] = [];
            studentsByClass[r.class_code].push({
                id: r.student_id,
                name: r.student_name,
                profilePictureUrl: r.profile_picture_url,
            });
        }
        const payload = classes.map((c) => ({
            classCode: c.class_code,
            courseId: c.course_id,
            courseName: c.course_name,
            teacher: c.teacher_name || null,
            taId: c.ta_id,
            schedule: c.schedule,
            maxStudents: c.max_students,
            status: c.status,
            students: studentsByClass[c.class_code] || [],
        }));
        res.json(payload);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching classes' });
    }
});
// GET /api/academic/attendance?month=YYYY-MM[&classCode=...]
router.get('/attendance', async (req, res) => {
    try {
        let { month, classCode } = req.query;
        if (!month) {
            const now = new Date();
            month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ message: 'month must be YYYY-MM' });
        }
        const likeStr = `${month}-%`;
        let sql = `SELECT id, student_id, class_code, DATE_FORMAT(date, '%Y-%m-%d') as date, status
               FROM attendance
               WHERE date LIKE ?`;
        const params = [likeStr];
        if (classCode) {
            sql += ` AND class_code = ?`;
            params.push(classCode);
        }
        sql += ` ORDER BY date, class_code, student_id`;
        const [rows] = await db_1.default.query(sql, params);
        const payload = rows.map((r) => ({
            id: r.id,
            studentId: r.student_id,
            classCode: r.class_code,
            date: r.date,
            status: r.status,
        }));
        res.json(payload);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching attendance' });
    }
});
// GET /api/academic/current-user?username=...
router.get('/current-user', async (req, res) => {
    try {
        const { username } = req.query;
        if (username) {
            const [rows] = await db_1.default.query(`SELECT id, username, name, role, email FROM system_users WHERE username = ? LIMIT 1`, [username]);
            if (rows.length > 0) {
                const r = rows[0];
                return res.json({
                    id: r.id,
                    username: r.username,
                    name: r.name,
                    role: r.role,
                    email: r.email,
                });
            }
        }
        // fallback demo user
        res.json({ id: 'demo-admin', username: 'admin', name: 'Admin Demo', role: 'ADMIN', email: 'admin@local' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching current user' });
    }
});
exports.default = router;
