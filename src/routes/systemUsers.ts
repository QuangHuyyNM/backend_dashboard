// src/routes/systemUsers.ts
import { Router, Request, Response } from "express";
import pool from "../db";
import bcrypt from "bcrypt";

const router = Router();

/**
 * Hệ thống user (CEO, ADMIN, IT)
 * - Bảng users (system_users) quản lý tài khoản hệ thống
 * - Employees chỉ cho HR/Teacher/TA...
 * 
 * Header 'x-requester-role' dùng để giả lập quyền (CEO, ADMIN,...)
 * Sau này thay bằng req.user.role sau khi có JWT middleware.
 */

// ========== GET ALL ==========
router.get("/", async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, role, status, created_at FROM users ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error("system-users GET / error:", err);
    res.status(500).json({ message: "DB error" });
  }
});

// ========== GET ONE ==========
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, role, status, created_at FROM users WHERE id = ?",
      [req.params.id]
    );
    const arr = rows as any[];
    if (!arr.length) return res.status(404).json({ message: "Not found" });
    res.json(arr[0]);
  } catch (err) {
    console.error("system-users GET /:id error:", err);
    res.status(500).json({ message: "DB error" });
  }
});

// ========== CREATE ==========
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, email, password, role = "ADMIN", status = "ACTIVE" } = req.body || {};
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Missing required fields (name, email, password)" });
    }

    const upperRole = String(role).toUpperCase();
    const requesterRole = (req.headers["x-requester-role"] as string) || null;

    if (upperRole === "CEO") {
      const [existing] = await pool.query(
        "SELECT id FROM users WHERE role = 'CEO' LIMIT 1"
      );
      const existingArr = existing as any[];
      if (existingArr.length > 0 && requesterRole !== "CEO") {
        return res
          .status(403)
          .json({ message: "CEO already exists. Only CEO can create another CEO." });
      }
    }

    const hash = await bcrypt.hash(String(password), 10);
    await pool.query(
      "INSERT INTO users (name,email,password,role,status) VALUES (?,?,?,?,?)",
      [name, email, hash, upperRole, status]
    );

    const [rows] = await pool.query(
      "SELECT id, name, email, role, status, created_at FROM users WHERE email = ?",
      [email]
    );
    res.status(201).json((rows as any)[0]);
  } catch (err: any) {
    console.error("system-users POST error:", err);
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Duplicate email" });
    }
    res.status(500).json({ message: err?.message || "Insert error" });
  }
});

// ========== UPDATE ==========
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const requesterRole = (req.headers["x-requester-role"] as string) || null;

    const [targetRows] = await pool.query("SELECT role FROM users WHERE id = ?", [id]);
    const targetArr = targetRows as any[];
    if (!targetArr.length) return res.status(404).json({ message: "Not found" });

    const updates: Record<string, any> = {};
    const allowed = new Set(["name", "email", "password", "role", "status"]);
    for (const k of Object.keys(req.body || {})) {
      if (allowed.has(k)) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length)
      return res.status(400).json({ message: "No updatable fields provided" });

    if (updates.role && String(updates.role).toUpperCase() === "CEO") {
      const [existing] = await pool.query(
        "SELECT id FROM users WHERE role = 'CEO' LIMIT 1"
      );
      const existingArr = existing as any[];
      if (existingArr.length > 0 && requesterRole !== "CEO") {
        return res.status(403).json({ message: "Only CEO can assign CEO role." });
      }
    }

    const params: any[] = [];
    const sets: string[] = [];

    if (updates.password) {
      const hash = await bcrypt.hash(String(updates.password), 10);
      sets.push("password = ?");
      params.push(hash);
      delete updates.password;
    }
    for (const k of Object.keys(updates)) {
      sets.push(`${k} = ?`);
      params.push(updates[k]);
    }
    params.push(id);

    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);

    const [rows] = await pool.query(
      "SELECT id, name, email, role, status, created_at FROM users WHERE id = ?",
      [id]
    );
    res.json((rows as any)[0]);
  } catch (err) {
    console.error("system-users PUT error:", err);
    res.status(500).json({ message: "Update error" });
  }
});

// ========== DELETE ==========
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const requesterRole = (req.headers["x-requester-role"] as string) || null;

    const [rows] = await pool.query("SELECT role FROM users WHERE id = ?", [id]);
    const arr = rows as any[];
    if (!arr.length) return res.status(404).json({ message: "Not found" });

    if (arr[0].role === "CEO" && requesterRole !== "CEO") {
      return res.status(403).json({ message: "Only CEO can delete CEO account." });
    }

    await pool.query("DELETE FROM users WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("system-users DELETE error:", err);
    res.status(500).json({ message: "Delete error" });
  }
});

export default router;
