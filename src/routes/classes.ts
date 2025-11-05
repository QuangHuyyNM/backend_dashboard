// src/routes/classes.ts
import { Router } from "express";
import pool from "../db"; // mong là bạn export mysql2/promise pool ở đây

const router = Router();

/**
 * Helper: generate candidate class_code and ensure uniqueness.
 * Strategy: use courseId prefix + timestamp slice + random digits.
 */
const generateUniqueClassCode = async (courseId) => {
  const prefix = (courseId || "CL")
    .toString()
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 6);
  for (let i = 0; i < 8; i++) {
    const candidate = `${prefix}-${Date.now()
      .toString()
      .slice(-4)}-${Math.floor(Math.random() * 900 + 100)}`;
    // check exists
    const [rows] = await pool.query(
      "SELECT 1 FROM classes WHERE class_code = ? LIMIT 1",
      [candidate]
    );
    if ((rows || []).length === 0) return candidate;
    // else loop and try another
  }
  // fallback: use UUID-like
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
};

/**
 * GET /api/classes
 * Optional query params: ?courseId=..., ?status=..., ?teacherId=...
 * Returns list of classes with joined course + teacher names.
 */
router.get("/", async (req, res) => {
  try {
    const { courseId, status, teacherId } = req.query;
    const where = [];
    const params = [];

    if (courseId) {
      where.push("c.course_id = ?");
      params.push(courseId);
    }
    if (status) {
      where.push("c.status = ?");
      params.push(status);
    }
    if (teacherId) {
      where.push("c.teacher_id = ?");
      params.push(teacherId);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT
        c.class_code,
        c.course_id,
        co.name AS course_name,
        c.teacher_id,
        t.name AS teacher_name,
        c.ta_id,
        ta.name AS ta_name,
        c.schedule,
        c.max_students,
        c.status,
        c.created_at,
        c.updated_at
      FROM classes c
      LEFT JOIN courses co ON co.id = c.course_id
      LEFT JOIN employees t ON t.id = c.teacher_id
      LEFT JOIN employees ta ON ta.id = c.ta_id
      ${whereSql}
      ORDER BY c.created_at DESC
    `;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/classes error:", err);
    res.status(500).json({ message: "DB error while fetching classes" });
  }
});

/**
 * GET /api/classes/:id
 * id is class_code
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT
        c.class_code,
        c.course_id,
        co.name AS course_name,
        c.teacher_id,
        t.name AS teacher_name,
        c.ta_id,
        ta.name AS ta_name,
        c.schedule,
        c.max_students,
        c.status,
        c.created_at,
        c.updated_at
      FROM classes c
      LEFT JOIN courses co ON co.id = c.course_id
      LEFT JOIN employees t ON t.id = c.teacher_id
      LEFT JOIN employees ta ON ta.id = c.ta_id
      WHERE c.class_code = ?
      LIMIT 1
    `;
    const [rows] = await pool.query(sql, [id]);
    const arr = rows || [];
    if (arr.length === 0)
      return res.status(404).json({ message: "Class not found" });
    res.json(arr[0]);
  } catch (err) {
    console.error("GET /api/classes/:id error:", err);
    res.status(500).json({ message: "DB error while fetching class" });
  }
});

/**
 * POST /api/classes
 * Body expected:
 * {
 *   classCode?: string | null,
 *   courseId: string,
 *   teacherId?: string | null,
 *   taId?: string | null,
 *   schedule: string,
 *   maxStudents?: number,
 *   status?: string,
 *   studentIds?: string[] | null,
 *   notes?: string | null
 * }
 */
router.post("/", async (req, res) => {
  const {
    classCode,
    courseId,
    teacherId = null,
    taId = null,
    schedule,
    maxStudents = 15,
    status = "Sắp khai giảng",
    studentIds = null, // if you have class_students table you should insert later
    notes = null,
  } = req.body || {};

  if (!courseId || !schedule) {
    return res
      .status(400)
      .json({ message: "Missing required fields: courseId and schedule" });
  }

  try {
    // determine code
    let codeToUse = (classCode && String(classCode).trim()) || null;
    if (codeToUse) {
      // ensure not exists
      const [exists] = await pool.query(
        "SELECT 1 FROM classes WHERE class_code = ? LIMIT 1",
        [codeToUse]
      );
      if ((exists || []).length > 0) {
        return res.status(409).json({ message: "class_code already exists" });
      }
    } else {
      codeToUse = await generateUniqueClassCode(courseId);
    }

    const sql = `INSERT INTO classes (class_code, course_id, teacher_id, ta_id, schedule, max_students, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      codeToUse,
      courseId,
      teacherId,
      taId,
      schedule,
      Number(maxStudents || 0),
      status,
    ];

    await pool.query(sql, params);

    // Optionally, if you want to save studentIds into class_students join table
    if (Array.isArray(studentIds) && studentIds.length > 0) {
      // insert ignoring duplicates
      const insertRows = studentIds.map((sid) => [codeToUse, sid]);
      try {
        await pool.query(
          "INSERT IGNORE INTO class_students (class_code, student_id) VALUES ?",
          [insertRows]
        );
      } catch (e) {
        // non-fatal: log but continue
        console.warn("class_students insert warning", e);
      }
    }

    // fetch the created record with joins to return a rich object
    const [createdRows] = await pool.query(
      `SELECT c.class_code, c.course_id, co.name AS course_name, c.teacher_id, t.name AS teacher_name,
              c.ta_id, ta.name AS ta_name, c.schedule, c.max_students, c.status, c.created_at, c.updated_at
       FROM classes c
       LEFT JOIN courses co ON co.id = c.course_id
       LEFT JOIN employees t ON t.id = c.teacher_id
       LEFT JOIN employees ta ON ta.id = c.ta_id
       WHERE c.class_code = ? LIMIT 1`,
      [codeToUse]
    );

    res.status(201).json((createdRows || [])[0]);
  } catch (err) {
    console.error("POST /api/classes error:", err);
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Duplicate entry" });
    }
    res.status(500).json({ message: "DB error while creating class" });
  }
});

/**
 * PUT /api/classes/:id
 * Update allowed fields: course_id, teacher_id, ta_id, schedule, max_students, status
 * Body may contain one or many fields.
 */
router.put("/:id", async (req, res) => {
  const { id } = req.params; // class_code
  const { courseId, teacherId, taId, schedule, maxStudents, status } =
    req.body || {};

  // prepare dynamic update
  const updates = [];
  const params = [];

  if (courseId !== undefined) {
    updates.push("course_id = ?");
    params.push(courseId);
  }
  if (teacherId !== undefined) {
    updates.push("teacher_id = ?");
    params.push(teacherId || null);
  }
  if (taId !== undefined) {
    updates.push("ta_id = ?");
    params.push(taId || null);
  }
  if (schedule !== undefined) {
    updates.push("schedule = ?");
    params.push(schedule);
  }
  if (maxStudents !== undefined) {
    updates.push("max_students = ?");
    params.push(Number(maxStudents || 0));
  }
  if (status !== undefined) {
    updates.push("status = ?");
    params.push(status);
  }

  if (updates.length === 0) {
    return res.status(400).json({ message: "No updatable fields provided" });
  }

  try {
    // check exists
    const [exists] = await pool.query(
      "SELECT 1 FROM classes WHERE class_code = ? LIMIT 1",
      [id]
    );
    if ((exists || []).length === 0) {
      return res.status(404).json({ message: "Class not found" });
    }

    const sql = `UPDATE classes SET ${updates.join(
      ", "
    )}, updated_at = CURRENT_TIMESTAMP WHERE class_code = ?`;
    params.push(id);
    await pool.query(sql, params);

    // return updated record (with joins)
    const [rows] = await pool.query(
      `SELECT c.class_code, c.course_id, co.name AS course_name, c.teacher_id, t.name AS teacher_name,
              c.ta_id, ta.name AS ta_name, c.schedule, c.max_students, c.status, c.created_at, c.updated_at
       FROM classes c
       LEFT JOIN courses co ON co.id = c.course_id
       LEFT JOIN employees t ON t.id = c.teacher_id
       LEFT JOIN employees ta ON ta.id = c.ta_id
       WHERE c.class_code = ? LIMIT 1`,
      [id]
    );

    res.json((rows || [])[0]);
  } catch (err) {
    console.error("PUT /api/classes/:id error:", err);
    res.status(500).json({ message: "DB error while updating class" });
  }
});

/**
 * DELETE /api/classes/:id
 * Removes class and (optionally) related class_students if FK cascade not set.
 */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [exists] = await pool.query(
      "SELECT 1 FROM classes WHERE class_code = ? LIMIT 1",
      [id]
    );
    if ((exists || []).length === 0) {
      return res.status(404).json({ message: "Class not found" });
    }

    // If you want to remove join rows explicitly (if FK not cascade)
    try {
      await pool.query("DELETE FROM class_students WHERE class_code = ?", [id]);
    } catch (e) {
      // ignore if table not exists or other minor errors
    }

    await pool.query("DELETE FROM classes WHERE class_code = ?", [id]);
    res.json({ message: "Deleted", id });
  } catch (err) {
    console.error("DELETE /api/classes/:id error:", err);
    res.status(500).json({ message: "DB error while deleting class" });
  }
});

export default router;
