// backend/src/routes/teachingLogs.ts
import { Router, Request, Response } from "express";
import pool from "../db";
import { v4 as uuidv4 } from "uuid";

const router = Router();

/**
 * GET /api/teaching-logs
 * Query:
 *   teacherId, classCode, month (YYYY-MM), q, page, limit, sort, order
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      teacherId,
      classCode,
      month,
      q,
      page = "1",
      limit = "20",
      sort = "date",
      order = "desc",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page || "1", 10));
    const pageSize = Math.max(1, parseInt(limit || "20", 10));
    const offset = (pageNum - 1) * pageSize;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (teacherId) {
      whereClauses.push("tl.teacher_id = ?");
      params.push(teacherId);
    }
    if (classCode) {
      whereClauses.push("tl.class_code = ?");
      params.push(classCode);
    }
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const start = `${month}-01`;
      const [y, m] = month.split("-");
      const endDate = new Date(Number(y), Number(m), 0);
      const end = `${y}-${String(Number(m)).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
      whereClauses.push("tl.date BETWEEN ? AND ?");
      params.push(start, end);
    }
    if (q) {
      whereClauses.push("(tl.note LIKE ? OR tl.class_code LIKE ? OR c.name LIKE ? OR e.name LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countSql = `SELECT COUNT(*) as total
                      FROM teaching_logs tl
                      LEFT JOIN courses c ON c.id = tl.course_id
                      LEFT JOIN employees e ON e.id = tl.teacher_id
                      ${whereSQL}`;
    const [countRows]: any = await pool.query(countSql, params);
    const total = countRows[0]?.total || 0;

    const validSort = ["date", "teacher_name", "class_code", "created_at"];
    const sortCol = validSort.includes(sort) ? sort : "date";
    const ord = order?.toLowerCase() === "asc" ? "ASC" : "DESC";

    // safe sort column mapping
    const sortMap: Record<string, string> = {
      date: "tl.date",
      teacher_name: "e.name",
      class_code: "tl.class_code",
      created_at: "tl.created_at",
    };

    const sql = `
      SELECT tl.*, e.name as teacher_name, c.name as course_name
      FROM teaching_logs tl
      LEFT JOIN employees e ON e.id = tl.teacher_id
      LEFT JOIN courses c ON c.id = tl.course_id
      ${whereSQL}
      ORDER BY ${sortMap[sortCol] || "tl.date"} ${ord}
      LIMIT ? OFFSET ?
    `;
    const rowsParams = [...params, pageSize, offset];
    const [rows]: any = await pool.query(sql, rowsParams);

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: pageSize, pages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error("teaching-logs GET err:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/** GET single log */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [rows]: any = await pool.query(
      `SELECT tl.*, e.name as teacher_name, c.name as course_name
       FROM teaching_logs tl
       LEFT JOIN employees e ON e.id = tl.teacher_id
       LEFT JOIN courses c ON c.id = tl.course_id
       WHERE tl.id = ? LIMIT 1`,
      [id]
    );
    if (!rows || rows.length === 0) return res.status(404).json({ message: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("teaching-logs GET/:id err:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/** POST create */
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      teacher_id,
      class_code,
      course_id,
      date,
      start_time,
      end_time,
      attendees,
      note,
      created_by,
    } = req.body;

    if (!date) return res.status(400).json({ message: "date is required" });

    const id = `LOG-${uuidv4()}`.slice(0, 50);

    await pool.query(
      `INSERT INTO teaching_logs (id, teacher_id, class_code, course_id, date, start_time, end_time, attendees, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, teacher_id || null, class_code || null, course_id || null, date, start_time || null, end_time || null, attendees || 0, note || null, created_by || null]
    );

    const [newRows]: any = await pool.query(`SELECT * FROM teaching_logs WHERE id = ? LIMIT 1`, [id]);
    res.status(201).json(newRows[0]);
  } catch (err: any) {
    console.error("teaching-logs POST err:", err);
    // FK error -> 1452
    if (err && err.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({ message: "Referenced teacher_id/class_code/course_id not found" });
    }
    res.status(500).json({ message: "Server error creating log" });
  }
});

/** PUT update */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const upFields = req.body || {};
    const allowed = ["teacher_id","class_code","course_id","date","start_time","end_time","attendees","note"];
    const sets: string[] = [];
    const params: any[] = [];
    for (const k of allowed) {
      if (k in upFields) {
        sets.push(`${k} = ?`);
        params.push(upFields[k]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ message: "No fields to update" });
    params.push(id);
    await pool.query(`UPDATE teaching_logs SET ${sets.join(", ")} WHERE id = ?`, params);
    const [rows]: any = await pool.query(`SELECT * FROM teaching_logs WHERE id = ? LIMIT 1`, [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error("teaching-logs PUT err:", err);
    res.status(500).json({ message: "Server error updating log" });
  }
});

/** DELETE */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM teaching_logs WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("teaching-logs DELETE err:", err);
    res.status(500).json({ message: "Server error deleting log" });
  }
});

export default router;
