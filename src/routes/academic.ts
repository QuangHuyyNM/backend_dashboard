// backend/src/routes/academic.ts
import { Router, Request, Response } from "express";
import pool from "../db";
const router = Router();

// GET /api/academic/classes
router.get('/classes', async (req: Request, res: Response) => {
  try {
    const [classes]: any = await pool.query(
      `SELECT c.class_code, c.course_id, c.teacher_id, c.ta_id, c.schedule, c.max_students, c.status,
              co.name as course_name,
              e.name as teacher_name
       FROM classes c
       LEFT JOIN courses co ON co.id = c.course_id
       LEFT JOIN employees e ON e.id = c.teacher_id
       ORDER BY c.class_code`
    );

    const [classStudentRows]: any = await pool.query(
      `SELECT cs.class_code, s.id as student_id, s.name as student_name, s.profile_picture_url
       FROM class_students cs
       JOIN students s ON s.id = cs.student_id`
    );

    const studentsByClass: Record<string, any[]> = {};
    for (const r of classStudentRows) {
      if (!studentsByClass[r.class_code]) studentsByClass[r.class_code] = [];
      studentsByClass[r.class_code].push({
        id: r.student_id,
        name: r.student_name,
        profilePictureUrl: r.profile_picture_url,
      });
    }

    const payload = classes.map((c: any) => ({
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching classes' });
  }
});

// GET /api/academic/attendance?month=YYYY-MM[&classCode=...]
router.get('/attendance', async (req: Request, res: Response) => {
  try {
    let { month, classCode } = req.query as { month?: string; classCode?: string };
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
    const params: any[] = [likeStr];

    if (classCode) {
      sql += ` AND class_code = ?`;
      params.push(classCode);
    }

    sql += ` ORDER BY date, class_code, student_id`;

    const [rows]: any = await pool.query(sql, params);

    const payload = rows.map((r: any) => ({
      id: r.id,
      studentId: r.student_id,
      classCode: r.class_code,
      date: r.date,
      status: r.status,
    }));

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching attendance' });
  }
});

// GET /api/academic/current-user?username=...
router.get('/current-user', async (req: Request, res: Response) => {
  try {
    const { username } = req.query as { username?: string };
    if (username) {
      const [rows]: any = await pool.query(`SELECT id, username, name, role, email FROM system_users WHERE username = ? LIMIT 1`, [username]);
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching current user' });
  }
});

export default router;
