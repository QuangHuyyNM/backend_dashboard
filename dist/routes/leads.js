"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/lead.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const uuid_1 = require("uuid");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
/**
 * Health-check (gọn) to verify server + DB reachable
 * GET /api/leads/health
 */
router.get("/health", async (_req, res) => {
    try {
        // simple test query
        const [rows] = await db_1.default.query("SELECT 1 as ok");
        res.json({ ok: true, db: rows && rows.length ? rows[0] : null });
    }
    catch (err) {
        console.error("[leads][health] db error:", err && err.stack ? err.stack : err);
        res.status(500).json({ ok: false, message: "DB unreachable", error: err?.message || String(err) });
    }
});
/**
 * GET /api/leads
 * Permission: VIEW_LEADS
 */
router.get("/", auth_middleware_1.requireAuth, (0, auth_middleware_1.requirePermission)("VIEW_LEADS"), async (req, res) => {
    try {
        const { page = "1", limit = "20", q, status, assigned_to, sort, } = req.query;
        const pageNum = Math.max(1, parseInt(String(page) || "1"));
        const limitNum = Math.max(1, parseInt(String(limit) || "20"));
        const offset = (pageNum - 1) * limitNum;
        const whereClauses = [];
        const params = [];
        if (q && q.trim() !== "") {
            const like = `%${q.trim()}%`;
            whereClauses.push("(name LIKE ? OR phone LIKE ? OR id LIKE ?)");
            params.push(like, like, like);
        }
        if (status && status.trim() !== "") {
            whereClauses.push("status = ?");
            params.push(status.trim());
        }
        if (assigned_to && assigned_to.trim() !== "") {
            whereClauses.push("assigned_to = ?");
            params.push(assigned_to.trim());
        }
        const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
        let orderBy = "last_contacted DESC";
        if (sort && typeof sort === "string") {
            const [fieldRaw, dirRaw] = sort.split(":");
            const allowedFields = ["last_contacted", "name", "created_at", "id"];
            const field = allowedFields.includes(fieldRaw) ? fieldRaw : "last_contacted";
            const direction = (dirRaw || "desc").toUpperCase() === "ASC" ? "ASC" : "DESC";
            orderBy = `${field} ${direction}`;
        }
        const dataQuery = `
      SELECT id, name, phone, source, assigned_to, status, last_contacted, created_at
      FROM leads
      ${whereSQL}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
        const dataParams = [...params, limitNum, offset];
        console.debug("[leads] dataQuery:", dataQuery.trim());
        console.debug("[leads] dataParams:", dataParams);
        const [rows] = await db_1.default.query(dataQuery, dataParams);
        const countQuery = `
      SELECT COUNT(*) as total
      FROM leads
      ${whereSQL}
    `;
        console.debug("[leads] countQuery:", countQuery.trim());
        console.debug("[leads] countParams:", params);
        const [countRows] = await db_1.default.query(countQuery, params);
        const total = (countRows && countRows[0] && Number(countRows[0].total)) || 0;
        res.json({ rows: rows || [], total, page: pageNum, limit: limitNum });
    }
    catch (err) {
        console.error("[leads][GET /] error:", err && err.stack ? err.stack : err);
        res.status(500).json({ message: "DB error", error: err?.message || String(err) });
    }
});
/**
 * POST /api/leads
 * Permission: EDIT_LEADS
 */
router.post("/", auth_middleware_1.requireAuth, (0, auth_middleware_1.requirePermission)("EDIT_LEADS"), async (req, res) => {
    try {
        const { id, name, phone, source, assigned_to, status, last_contacted } = req.body || {};
        if (!name || String(name).trim() === "") {
            return res.status(400).json({ message: "Tên lead là bắt buộc" });
        }
        const newId = id || `LEAD-${(0, uuid_1.v4)()}`;
        const now = new Date().toISOString().slice(0, 10);
        const insertSQL = `INSERT INTO leads (id, name, phone, source, assigned_to, status, last_contacted, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`;
        const insertParams = [
            newId,
            String(name).trim(),
            phone || null,
            source || null,
            assigned_to || null,
            status || "Mới",
            last_contacted || now,
            req.user?.id || null,
        ];
        console.debug("[leads][POST] insertSQL:", insertSQL);
        console.debug("[leads][POST] insertParams:", insertParams);
        await db_1.default.query(insertSQL, insertParams);
        const [rows] = await db_1.default.query("SELECT * FROM leads WHERE id = ?", [newId]);
        res.status(201).json({ message: "Lead created", lead: (rows && rows[0]) || { id: newId } });
    }
    catch (err) {
        console.error("[leads][POST] error:", err && err.stack ? err.stack : err);
        res.status(500).json({ message: "Insert error", error: err?.message || String(err) });
    }
});
/**
 * PUT /api/leads/:id
 * Permission: EDIT_LEADS
 */
router.put("/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requirePermission)("EDIT_LEADS"), async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body || {};
        const allowed = ["name", "phone", "source", "assigned_to", "status", "last_contacted"];
        const keys = Object.keys(fields).filter((k) => allowed.includes(k));
        if (keys.length === 0) {
            return res.status(400).json({ message: "No valid fields to update" });
        }
        const sets = keys.map((k) => `${k} = ?`).join(", ");
        const values = keys.map((k) => fields[k]);
        values.push(id);
        const updateSQL = `UPDATE leads SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        console.debug("[leads][PUT] updateSQL:", updateSQL);
        console.debug("[leads][PUT] values:", values);
        const [result] = await db_1.default.query(updateSQL, values);
        if (!result || result.affectedRows === 0) {
            return res.status(404).json({ message: "Không tìm thấy lead" });
        }
        const [rows] = await db_1.default.query("SELECT * FROM leads WHERE id = ?", [id]);
        res.json({ message: "Lead updated", lead: (rows && rows[0]) || null });
    }
    catch (err) {
        console.error("[leads][PUT] error:", err && err.stack ? err.stack : err);
        res.status(500).json({ message: "Update error", error: err?.message || String(err) });
    }
});
/**
 * DELETE /api/leads/:id
 * Permission: EDIT_LEADS
 */
router.delete("/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requirePermission)("EDIT_LEADS"), async (req, res) => {
    try {
        const id = req.params.id;
        const [result] = await db_1.default.query("UPDATE leads SET status = 'DELETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
        if (!result || result.affectedRows === 0) {
            return res.status(404).json({ message: "Không tìm thấy lead" });
        }
        res.json({ message: "Lead deleted" });
    }
    catch (err) {
        console.error("[leads][DELETE] error:", err && err.stack ? err.stack : err);
        res.status(500).json({ message: "Delete error", error: err?.message || String(err) });
    }
});
exports.default = router;
