// src/routes/employees.ts
import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

const keyMap: Record<string, string> = {
  startDate: "start_date",
  bankAccountNumber: "bank_account_number",
  profilePictureUrl: "profile_picture_url",
  profileFileUrl: "profile_file_url",
  hourlyRate: "hourly_rate",
};

const allowedFields = new Set([
  "name",
  "role",
  "position",
  "email",
  "phone",
  "start_date",
  "status",
  "dob",
  "gender",
  "bank_account_number",
  "bank_name",
  "profile_picture_url",
  "profile_file_url",
  "hourly_rate",
  // keep roles & permissions out of automatic normalized map — we'll handle them separately
]);

function normalizeKey(k: string) {
  return keyMap[k] ?? k;
}

// helper: parse JSON columns safely (roles/permissions)
function safeParseArrayField(val: any): any[] {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    // sometimes DB stores JSON string or comma separated string
    const trimmed = val.trim();
    if (!trimmed) return [];
    // try JSON.parse first
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      // fallback: comma separated
      return trimmed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * Additional helpers for request-side normalization/validation
 */

// Allowed roles in system — keep in sync with frontend ALL_ROLES
const ALLOWED_ROLES = [
  "CEO",
  "HR",
  "ACADEMIC",
  "ADMISSIONS",
  "FINANCE",
  "TEACHER",
  "TA",
  "RECEPTIONIST",
];

/**
 * Accepts:
 *  - array of strings
 *  - JSON string representation of array
 *  - comma-separated string like "HR,TEACHER"
 * Returns array of trimmed uppercase-preserving strings.
 * Throws error if invalid type or contains roles not in ALLOWED_ROLES.
 */
function normalizeRolesInput(val: any): string[] {
  if (val == null) return [];
  let arr: any[] = [];
  if (Array.isArray(val)) {
    arr = val;
  } else if (typeof val === "string") {
    const s = val.trim();
    if (!s) arr = [];
    else {
      // try JSON parse
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) arr = parsed;
        else
          arr = s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
      } catch (e) {
        arr = s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      }
    }
  } else {
    throw new Error("roles must be an array or string");
  }

  // normalize elements to strings, trim, and validate allowed roles
  const normalized = arr
    .map((x) => (x == null ? "" : String(x).trim()))
    .filter(Boolean);

  // Validate each role
  for (const r of normalized) {
    if (!ALLOWED_ROLES.includes(r)) {
      throw new Error(`Invalid role: ${r}`);
    }
  }

  return normalized;
}

/**
 * Accepts array or JSON string or comma-separated strings.
 * Returns array of trimmed strings.
 */
function normalizePermissionsInput(val: any): string[] {
  if (val == null) return [];
  let arr: any[] = [];
  if (Array.isArray(val)) arr = val;
  else if (typeof val === "string") {
    const s = val.trim();
    if (!s) arr = [];
    else {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) arr = parsed;
        else
          arr = s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
      } catch (e) {
        arr = s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      }
    }
  } else {
    throw new Error("permissions must be an array or string");
  }

  return arr.map((x) => String(x).trim()).filter(Boolean);
}

// ===========================================================
// EMPLOYEES API – loại trừ CEO (CEO chỉ thuộc system_users)
// ===========================================================

// GET all employees (exclude CEO)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM employees WHERE role <> 'CEO' ORDER BY id"
    );
    const out = (rows as any[]).map((r) => {
      return {
        ...r,
        roles: safeParseArrayField(r.roles),
        permissions: safeParseArrayField(r.permissions),
      };
    });
    res.json(out);
  } catch (err) {
    console.error("employees GET / error:", err);
    res.status(500).json({ message: "DB error" });
  }
});

// GET one employee
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query("SELECT * FROM employees WHERE id = ?", [
      req.params.id,
    ]);
    const arr = rows as any[];
    if (!arr.length) return res.status(404).json({ message: "Not found" });

    if ((arr[0].role || "").toUpperCase() === "CEO") {
      return res.status(403).json({
        message:
          "CEO is system user and cannot be accessed via employees endpoint.",
      });
    }

    const r = arr[0];
    r.roles = safeParseArrayField(r.roles);
    r.permissions = safeParseArrayField(r.permissions);

    res.json(r);
  } catch (err) {
    console.error("employees GET /:id error:", err);
    res.status(500).json({ message: "DB error" });
  }
});

// CREATE employee (disallow CEO)
router.post("/", async (req: Request, res: Response) => {
  try {
    const body: Record<string, any> = {};
    for (const k of Object.keys(req.body)) {
      body[normalizeKey(k)] = req.body[k];
    }

    // ✅ Cho phép không cần gửi id => backend sẽ sinh
    const required = ["name", "email", "role"];

    if (!body.id) {
      const [rows] = await pool.query(
        "SELECT MAX(CAST(SUBSTRING(id, 4) AS UNSIGNED)) as max_num FROM employees WHERE id LIKE 'RTE%'"
      );
      const maxNum = (rows as any)[0]?.max_num ?? 0;
      const nextNum = maxNum + 1;
      body.id = `RTE${nextNum.toString().padStart(3, "0")}`;
    }
    console.log("INSERT employee: id=", body.id, "email=", body.email);

    if (String(body.role).toUpperCase() === "CEO") {
      return res.status(403).json({
        message:
          "Không thể tạo nhân sự có vai trò CEO qua HR (chỉ DB/systemUsers).",
      });
    }

    // Normalize roles & permissions if provided
    let rolesCol: string | null = null;
    let permsCol: string | null = null;

    try {
      if (req.body.roles !== undefined) {
        const normalizedRoles = normalizeRolesInput(req.body.roles);
        rolesCol = JSON.stringify(normalizedRoles);
        // ensure primary role column consistent (first role)
        if (normalizedRoles.length > 0) {
          body.role = body.role ?? normalizedRoles[0];
        }
      }
    } catch (err: any) {
      return res.status(400).json({ message: err?.message || "Invalid roles" });
    }

    try {
      if (req.body.permissions !== undefined) {
        const normalizedPerms = normalizePermissionsInput(req.body.permissions);
        permsCol = JSON.stringify(normalizedPerms);
      }
    } catch (err: any) {
      return res
        .status(400)
        .json({ message: err?.message || "Invalid permissions" });
    }

    const sql = `INSERT INTO employees
      (id,name,role,position,email,phone,start_date,status,dob,gender,
       bank_account_number,bank_name,profile_picture_url,profile_file_url,hourly_rate, roles, permissions)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

    await pool.query(sql, [
      body.id,
      body.name,
      body.role,
      body.position ?? null,
      body.email,
      body.phone ?? null,
      body.start_date ?? null,
      body.status ?? "ACTIVE",
      body.dob ?? null,
      body.gender ?? null,
      body.bank_account_number ?? null,
      body.bank_name ?? null,
      body.profile_picture_url ?? null,
      body.profile_file_url ?? null,
      body.hourly_rate ?? 0,
      rolesCol,
      permsCol,
    ]);

    const [rows] = await pool.query("SELECT * FROM employees WHERE id = ?", [
      body.id,
    ]);
    const r = (rows as any)[0];
    r.roles = safeParseArrayField(r.roles);
    r.permissions = safeParseArrayField(r.permissions);
    res.status(201).json(r);
  } catch (err: any) {
    console.error("employees POST error:", err);
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Duplicate id/email" });
    }
    res.status(500).json({ message: err?.message || "Insert error" });
  }
});

// UPDATE employee (disallow CEO or assign CEO)
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const [targetRows] = await pool.query(
      "SELECT role FROM employees WHERE id = ?",
      [id]
    );
    const arr = targetRows as any[];
    if (!arr.length) return res.status(404).json({ message: "Not found" });

    if ((arr[0].role || "").toUpperCase() === "CEO") {
      return res.status(403).json({
        message: "Không thể cập nhật nhân sự CEO qua HR (chỉ DB/systemUsers).",
      });
    }

    // We'll accept roles[] and permissions[] (arrays) explicitly.
    // For backward compatibility, we also accept "role" string (primary role).
    const normalized: Record<string, any> = {};
    for (const k of Object.keys(req.body)) {
      const nk = normalizeKey(k);
      if (allowedFields.has(nk)) {
        const val = req.body[k];
        // convert '' to null for date fields or nullable fields
        if (["start_date", "dob"].includes(nk) && val === "") {
          normalized[nk] = null;
        } else {
          normalized[nk] = val;
        }
      }

      // do NOT push roles/permissions into normalized here because they require JSON.stringify
    }

    // If status is not provided, default to "ACTIVE"
    if (!normalized.hasOwnProperty("status")) {
      normalized.status = "ACTIVE";
      console.log(`Defaulting status to ACTIVE for employee ${id}`);
    }

    // Handle roles & permissions separately
    const rolesPayloadRaw = req.body.roles;
    const permissionsPayloadRaw = req.body.permissions;

    // If client tries to set role to CEO -> deny (check also rolesPayload values)
    if (normalized.role && String(normalized.role).toUpperCase() === "CEO") {
      return res
        .status(403)
        .json({ message: "Không thể gán vai trò CEO từ website." });
    }

    // Validate and normalize rolesPayload if provided
    let rolesPayload: string[] | undefined = undefined;
    if (rolesPayloadRaw !== undefined) {
      try {
        const nr = normalizeRolesInput(rolesPayloadRaw);
        // if array contains CEO, deny
        if (nr.some((r) => String(r).toUpperCase() === "CEO")) {
          return res
            .status(403)
            .json({ message: "Không thể gán vai trò CEO từ website." });
        }
        rolesPayload = nr;
      } catch (err: any) {
        return res
          .status(400)
          .json({ message: err?.message || "Invalid roles" });
      }
    }

    // Validate and normalize permissionsPayload if provided
    let permissionsPayload: string[] | undefined = undefined;
    if (permissionsPayloadRaw !== undefined) {
      try {
        permissionsPayload = normalizePermissionsInput(permissionsPayloadRaw);
      } catch (err: any) {
        return res
          .status(400)
          .json({ message: err?.message || "Invalid permissions" });
      }
    }

    // Build update sets
    const sets: string[] = [];
    const params: any[] = [];

    // normalized simple fields
    for (const k of Object.keys(normalized)) {
      sets.push(`${k} = ?`);
      params.push(normalized[k]);
    }

    // roles => update roles column (JSON) and also update single role primary (if provided)
    if (rolesPayload !== undefined) {
      sets.push(`roles = ?`);
      params.push(JSON.stringify(rolesPayload));
      // also set primary role column to first element if exists
      if (rolesPayload.length > 0) {
        sets.push(`role = ?`);
        params.push(String(rolesPayload[0]));
      }
    }

    // permissions => update permissions column (JSON)
    if (permissionsPayload !== undefined) {
      sets.push(`permissions = ?`);
      params.push(JSON.stringify(permissionsPayload));
    }

    if (!sets.length)
      return res.status(400).json({ message: "No fields provided" });

    const sql = `UPDATE employees SET ${sets.join(", ")} WHERE id = ?`;
    params.push(id);

    await pool.query(sql, params);

    const [rows] = await pool.query("SELECT * FROM employees WHERE id = ?", [
      id,
    ]);
    const updated = (rows as any)[0];
    updated.roles = safeParseArrayField(updated.roles);
    updated.permissions = safeParseArrayField(updated.permissions);
    res.json(updated);
  } catch (err) {
    console.error("employees PUT error:", err);
    res.status(500).json({ message: "Update error" });
  }
});

// DELETE employee (disallow CEO)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query("SELECT role FROM employees WHERE id = ?", [
      req.params.id,
    ]);
    const arr = rows as any[];
    if (!arr.length) return res.status(404).json({ message: "Not found" });

    if ((arr[0].role || "").toUpperCase() === "CEO") {
      return res.status(403).json({
        message: "Không thể xoá nhân sự CEO qua HR (chỉ DB/systemUsers).",
      });
    }

    await pool.query("DELETE FROM employees WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("employees DELETE error:", err);
    res.status(500).json({ message: "Delete error" });
  }
});

export default router;
