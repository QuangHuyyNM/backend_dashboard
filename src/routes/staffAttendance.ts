// src/routes/staffAttendance.ts
import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

/* Helper: tồn tại employee? */
async function employeeExists(empId: string): Promise<boolean> {
  if (!empId) return false;
  const [rows] = await pool.query("SELECT 1 FROM employees WHERE id = ? LIMIT 1", [empId]);
  return Array.isArray(rows) && (rows as any[]).length > 0;
}

/* Helper: tồn tại class? */
async function classExists(classCode: string | null | undefined): Promise<boolean> {
  if (!classCode) return false;
  const [rows] = await pool.query("SELECT 1 FROM classes WHERE class_code = ? LIMIT 1", [classCode]);
  return Array.isArray(rows) && (rows as any[]).length > 0;
}

/**
 * deduceFromSessionId: cố suy luận { employee_id, date, class_code }
 * Heuristics:
 *  - match date prefix YYYY-MM-DD
 *  - rest: class_code is first token
 *  - prefer last token as employee_id (most robust)
 *  - fallback: join remainder after class_code (but only if that matches an employee id)
 */
async function deduceFromSessionId(sessionId: string) {
  if (!sessionId) return null;
  const m = String(sessionId).match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (!m) return null;
  const date = m[1];
  const rest = m[2];
  const parts = rest.split("-");
  if (parts.length < 2) return null;

  const class_code = parts[0];
  const lastToken = parts[parts.length - 1];

  // 1) try last token (common: RTE003)
  if (await employeeExists(lastToken)) {
    return { employee_id: lastToken, date, class_code };
  }

  // 2) try everything after class_code
  const after = parts.slice(1).join("-");
  if (await employeeExists(after)) {
    return { employee_id: after, date, class_code };
  }

  // 3) if second token numeric (eg random id), try skipping it
  if (parts.length >= 3 && /^\d+$/.test(parts[1])) {
    const cand = parts.slice(2).join("-");
    if (await employeeExists(cand)) {
      return { employee_id: cand, date, class_code };
    }
  }

  // 4) last resort: try LIKE match using lastToken
  const [rows] = await pool.query("SELECT id FROM employees WHERE id LIKE ? LIMIT 1", [`%${lastToken}%`]);
  if (Array.isArray(rows) && (rows as any[]).length > 0) {
    return { employee_id: (rows as any[])[0].id, date, class_code };
  }

  return null;
}

/* GET list */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { employee_id, date } = req.query;
    let sql = "SELECT * FROM staff_attendance";
    const params: any[] = [];

    if (employee_id || date) {
      const clauses: string[] = [];
      if (employee_id) {
        clauses.push("employee_id = ?");
        params.push(String(employee_id));
      }
      if (date) {
        clauses.push("date = ?");
        params.push(String(date));
      }
      sql += " WHERE " + clauses.join(" AND ");
    }

    sql += " ORDER BY date DESC, session_id DESC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("staff-attendance GET / error:", err);
    res.status(500).json({ message: "DB error" });
  }
});

/* POST : tạo hoặc upsert (cố suy luận employee/class nếu cần) */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { session_id, employee_id, date, class_code, status } = req.body || {};

    if (!session_id) return res.status(400).json({ message: "Missing session_id" });

    let finalEmployeeId = employee_id;
    let finalDate = date;
    let finalClassCode = class_code;

    if (!finalEmployeeId) {
      const ded = await deduceFromSessionId(session_id);
      if (ded) {
        finalEmployeeId = ded.employee_id;
        finalDate = finalDate || ded.date;
        finalClassCode = finalClassCode || ded.class_code;
      } else {
        return res.status(400).json({ message: "Missing employee_id and cannot deduce from session_id" });
      }
    }

    if (!finalEmployeeId || !finalDate) {
      return res.status(400).json({ message: "Missing required fields: employee_id and/or date" });
    }

    // verify class existence; if not exist -> set to NULL to avoid FK error (and log)
    if (finalClassCode && !(await classExists(finalClassCode))) {
      console.warn(`POST: class_code '${finalClassCode}' not found in classes table — inserting with class_code = NULL`);
      finalClassCode = null;
    }

    const st = (status || "PENDING").toString().toUpperCase();
    const allowed = new Set(["PENDING", "PRESENT", "ABSENT"]);
    const finalStatus = allowed.has(st) ? st : "PENDING";

    const sql = `
      INSERT INTO staff_attendance (session_id, employee_id, date, class_code, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        employee_id = VALUES(employee_id),
        date = VALUES(date),
        class_code = VALUES(class_code),
        status = VALUES(status),
        updated_at = NOW()
    `;
    try {
      await pool.query(sql, [session_id, finalEmployeeId, finalDate, finalClassCode || null, finalStatus]);
    } catch (err: any) {
      console.error("staff-attendance POST insert error (SQL/FK):", err);
      if (err?.errno === 1452) {
        return res.status(400).json({ message: "Invalid employee_id or class_code (foreign key)" });
      }
      return res.status(500).json({ message: "Insert error" });
    }

    const [rows] = await pool.query("SELECT * FROM staff_attendance WHERE session_id = ?", [session_id]);
    const saved = (rows as any[])[0];
    res.status(201).json(saved);
  } catch (err) {
    console.error("staff-attendance POST / error:", err);
    res.status(500).json({ message: "Insert error" });
  }
});

/* PUT : cập nhật status (nếu row không tồn tại thì cố chèn fallback, với class_code NULL nếu cần) */
router.put("/:session_id", async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.session_id || "");
    const { status } = req.body || {};
    if (!sessionId) return res.status(400).json({ message: "Missing session id" });
    if (!status) return res.status(400).json({ message: "Missing status in body" });

    const st = String(status).toUpperCase();
    if (!["PRESENT", "ABSENT", "PENDING"].includes(st)) {
      return res.status(400).json({ message: "Invalid status. Allowed: PRESENT | ABSENT | PENDING" });
    }

    const [updateRes] = await pool.query("UPDATE staff_attendance SET status = ?, updated_at = NOW() WHERE session_id = ?", [st, sessionId]);
    const affected = (updateRes as any).affectedRows ?? 0;

    if (affected === 0) {
      const ded = await deduceFromSessionId(sessionId);
      if (!ded) {
        return res.status(400).json({ message: "No existing row and cannot deduce employee/date/class from session_id" });
      }

      // nếu class không tồn tại, set NULL để tránh FK error
      const finalClass = (await classExists(ded.class_code)) ? ded.class_code : null;
      if (!finalClass) {
        console.warn(`PUT fallback: class_code '${ded.class_code}' not found -> using NULL to avoid FK error`);
      }

      try {
        const insertSql = `
          INSERT INTO staff_attendance (session_id, employee_id, date, class_code, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            employee_id = VALUES(employee_id),
            date = VALUES(date),
            class_code = VALUES(class_code),
            updated_at = NOW()
        `;
        await pool.query(insertSql, [sessionId, ded.employee_id, ded.date, finalClass, st]);
      } catch (err: any) {
        console.error("staff-attendance PUT insert fallback error:", err);
        if (err?.errno === 1452) {
          return res.status(400).json({ message: "Invalid employee_id or class_code (foreign key) when inserting fallback" });
        }
        return res.status(500).json({ message: "Insert fallback error" });
      }
    }

    const [rows] = await pool.query("SELECT * FROM staff_attendance WHERE session_id = ?", [sessionId]);
    const updated = (rows as any[])[0];
    res.json(updated);
  } catch (err) {
    console.error("staff-attendance PUT /:session_id error:", err);
    res.status(500).json({ message: "Update error" });
  }
});

/* DELETE */
router.delete("/:session_id", async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.session_id || "");
    if (!sessionId) return res.status(400).json({ message: "Missing session id" });
    await pool.query("DELETE FROM staff_attendance WHERE session_id = ?", [sessionId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("staff-attendance DELETE /:session_id error:", err);
    res.status(500).json({ message: "Delete error" });
  }
});

export default router;
