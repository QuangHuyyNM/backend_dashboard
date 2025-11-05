"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/vouchers.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
/**
 * POST /api/vouchers/validate
 * Body: { code, total_amount, course_id?, class_code? }
 * Returns preview: { valid, discount_amount, new_total, voucher: { ... } } or error
 */
router.post("/validate", auth_middleware_1.requireAuth, async (req, res) => {
    const { code, total_amount, course_id, class_code } = req.body || {};
    if (!code)
        return res.status(400).json({ message: "Mã voucher bắt buộc" });
    try {
        const [rows] = await db_1.default.query("SELECT * FROM vouchers WHERE code = ? AND status = 'ACTIVE' LIMIT 1", [code]);
        const voucher = rows && rows[0];
        if (!voucher)
            return res.status(404).json({ valid: false, message: "Voucher không tồn tại hoặc không hoạt động" });
        const now = new Date();
        if ((voucher.valid_from && new Date(voucher.valid_from) > now) || (voucher.valid_to && new Date(voucher.valid_to) < now)) {
            return res.status(400).json({ valid: false, message: "Voucher ngoài thời hạn" });
        }
        if (voucher.max_uses > 0 && voucher.used_count >= voucher.max_uses) {
            return res.status(400).json({ valid: false, message: "Voucher đã hết lượt sử dụng" });
        }
        const total = Number(total_amount || 0);
        if (voucher.min_purchase && total < Number(voucher.min_purchase)) {
            return res.status(400).json({ valid: false, message: `Yêu cầu mua tối thiểu ${voucher.min_purchase}` });
        }
        if (voucher.applicable_courses) {
            let arr = [];
            try {
                arr = JSON.parse(voucher.applicable_courses);
            }
            catch (e) {
                arr = [];
            }
            if (Array.isArray(arr) && arr.length > 0 && course_id) {
                if (!arr.includes(course_id)) {
                    return res.status(400).json({ valid: false, message: "Voucher không áp dụng cho khóa học này" });
                }
            }
        }
        // compute discount
        let discount = 0;
        if (voucher.discount_type === "PERCENTAGE") {
            discount = +(total * (Number(voucher.discount_value) / 100));
        }
        else {
            discount = Number(voucher.discount_value);
        }
        if (discount > total)
            discount = total;
        const newTotal = +(total - discount);
        return res.json({
            valid: true,
            discount_amount: discount,
            new_total: newTotal,
            voucher: {
                id: voucher.id,
                code: voucher.code,
                discount_type: voucher.discount_type,
                discount_value: voucher.discount_value,
                min_purchase: voucher.min_purchase,
                max_uses: voucher.max_uses,
                used_count: voucher.used_count
            }
        });
    }
    catch (err) {
        console.error("POST /api/vouchers/validate error", err);
        return res.status(500).json({ message: "Lỗi server khi kiểm tra voucher" });
    }
});
/**
 * POST /api/vouchers/apply-to-invoice/:invoiceId
 * Body: { code }
 * Transactional: validates voucher and applies it to invoice (update invoice fields and increment voucher.used_count)
 */
router.post("/apply-to-invoice/:invoiceId", auth_middleware_1.requireAuth, async (req, res) => {
    const { code } = req.body || {};
    const { invoiceId } = req.params;
    if (!code)
        return res.status(400).json({ message: "Mã voucher bắt buộc" });
    // Using getConnection for transaction
    const conn = await db_1.default.getConnection();
    try {
        await conn.beginTransaction();
        // lock invoice row
        const [invRows] = await conn.query("SELECT * FROM invoices WHERE id = ? FOR UPDATE", [invoiceId]);
        const invoice = invRows && invRows[0];
        if (!invoice) {
            await conn.rollback();
            return res.status(404).json({ message: "Không tìm thấy hóa đơn" });
        }
        // lock voucher row
        const [vRows] = await conn.query("SELECT * FROM vouchers WHERE code = ? FOR UPDATE", [code]);
        const voucher = vRows && vRows[0];
        if (!voucher || voucher.status !== "ACTIVE") {
            await conn.rollback();
            return res.status(400).json({ message: "Voucher không hợp lệ" });
        }
        const now = new Date();
        if ((voucher.valid_from && new Date(voucher.valid_from) > now) || (voucher.valid_to && new Date(voucher.valid_to) < now)) {
            await conn.rollback();
            return res.status(400).json({ message: "Voucher ngoài thời hạn" });
        }
        if (voucher.max_uses > 0 && voucher.used_count >= voucher.max_uses) {
            await conn.rollback();
            return res.status(400).json({ message: "Voucher đã hết lượt sử dụng" });
        }
        const invoiceTotal = Number(invoice.total_amount || 0);
        if (voucher.min_purchase && invoiceTotal < Number(voucher.min_purchase)) {
            await conn.rollback();
            return res.status(400).json({ message: `Yêu cầu mua tối thiểu ${voucher.min_purchase}` });
        }
        if (voucher.applicable_courses) {
            let arr = [];
            try {
                arr = JSON.parse(voucher.applicable_courses);
            }
            catch (e) {
                arr = [];
            }
            if (Array.isArray(arr) && arr.length > 0 && invoice.course_id && !arr.includes(invoice.course_id)) {
                await conn.rollback();
                return res.status(400).json({ message: "Voucher không áp dụng cho khóa học này" });
            }
        }
        // compute discount
        let discount = 0;
        if (voucher.discount_type === "PERCENTAGE") {
            discount = +(invoiceTotal * (Number(voucher.discount_value) / 100));
        }
        else {
            discount = Number(voucher.discount_value);
        }
        if (discount > invoiceTotal)
            discount = invoiceTotal;
        const original_total = invoice.original_total ?? invoiceTotal;
        const new_total = +(original_total - discount);
        // update invoice: set voucher_code, discount_amount, original_total (if null), total_amount = new_total
        await conn.query(`UPDATE invoices 
       SET voucher_code = ?, discount_amount = ?, original_total = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [voucher.code, discount, original_total, new_total, invoiceId]);
        // increment used_count
        const newUsed = Number(voucher.used_count || 0) + 1;
        await conn.query("UPDATE vouchers SET used_count = ? WHERE id = ?", [newUsed, voucher.id]);
        await conn.commit();
        // return updated invoice
        const [updatedRows] = await db_1.default.query("SELECT i.*, (SELECT name FROM students WHERE id = i.student_id) as student_name FROM invoices i WHERE i.id = ?", [invoiceId]);
        return res.json({ success: true, invoice: updatedRows && updatedRows[0], discount_amount: discount });
    }
    catch (err) {
        console.error("POST /api/vouchers/apply-to-invoice error", err);
        try {
            await conn.rollback();
        }
        catch (e) { }
        return res.status(500).json({ message: "Lỗi khi áp dụng voucher" });
    }
    finally {
        try {
            conn.release();
        }
        catch (e) { }
    }
});
exports.default = router;
