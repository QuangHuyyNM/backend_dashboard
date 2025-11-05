// src/routes/attendance.ts
import { Router, Request, Response } from "express";
import pool from "../db"; // assume mysql2/promise pool

const router = Router();

/**
 * GET /api/attendance
 * Optional query: ?class_code=...&date=YYYY-MM-DD
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { class_code, date } = req.query;
    let sql = "SELECT * FROM attendance";
    const params: any[] = [];
    if (class_code || date) {
      const clauses: string[] = [];
      if (class_code) { clauses.push("class_code = ?"); params.push(class_code); }
      if (date) { clauses.push("date = ?"); params.push(date); }
      sql += " WHERE " + clauses.join(" AND ");
    }
    sql += " ORDER BY date DESC, id DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /attendance error:", err);
    res.status(500).json({ message: "DB error" });
  }
});

/**
 * POST /api/attendance
 * Accepts either:
 * - a single object: { student_id, class_code, date, status }
 * - or an array: [{ student_id, class_code, date, status }, ...]
 *
 * For each record performs upsert: if (student_id,class_code,date) exists => update status; else insert.
 * All operations executed inside a transaction for atomicity.
 */
router.post("/", async (req: Request, res: Response) => {
  let connection: any;
  try {
    const payload = req.body;
    const records = Array.isArray(payload) ? payload : [payload];

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: "Payload must be non-empty array or object" });
    }

    // basic validation
    for (const r of records) {
      if (!r.student_id || !r.class_code || !r.date) {
        return res.status(400).json({ message: "Each record must contain student_id, class_code and date" });
      }
    }

    // get connection & transaction
    connection = await (pool as any).getConnection();
    await connection.beginTransaction();

    const saved: any[] = [];

    for (const r of records) {
      const student_id = String(r.student_id);
      const class_code = String(r.class_code);
      const date = String(r.date);
      const status = r.status || "Not Set";

      // check exists
      const [existsRows]: any = await connection.query(
        "SELECT id FROM attendance WHERE student_id = ? AND class_code = ? AND date = ? LIMIT 1",
        [student_id, class_code, date]
      );

      if (Array.isArray(existsRows) && existsRows.length > 0) {
        const id = existsRows[0].id;
        await connection.query("UPDATE attendance SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, id]);
        const [row] = await connection.query("SELECT * FROM attendance WHERE id = ?", [id]);
        if (Array.isArray(row) && row.length > 0) saved.push(row[0]);
      } else {
        const [result]: any = await connection.query(
          "INSERT INTO attendance (student_id, class_code, date, status) VALUES (?, ?, ?, ?)",
          [student_id, class_code, date, status]
        );
        const insertId = result.insertId;
        const [row] = await connection.query("SELECT * FROM attendance WHERE id = ?", [insertId]);
        if (Array.isArray(row) && row.length > 0) saved.push(row[0]);
      }
    }

    await connection.commit();
    res.status(201).json(saved);
  } catch (err) {
    console.error("POST /attendance error:", err);
    if (connection) {
      try { await connection.rollback(); } catch (_) {}
    }
    res.status(500).json({ message: "Insert/update error" });
  } finally {
    if (connection) connection.release();
  }
});

export default router;
