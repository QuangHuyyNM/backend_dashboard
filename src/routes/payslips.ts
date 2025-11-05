// src/routes/payslips.ts
import express from "express";
import pool from "../db";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requirePermission } from "../middlewares/auth.middleware";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import streamBuffers from "stream-buffers";

const router = express.Router();

/**
 * Robust payslips routes
 * - tolerant to schema variations (id vs payslip_id, created_at vs paid_at)
 * - converts DB string decimals to numbers before doing toFixed / arithmetic
 * - uses defensive SQL (check columns) to avoid Unknown column errors
 */

// Helper: check if a table exists
async function tableExists(tableName: string) {
  const [rows]: any = await pool.query(
    "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName]
  );
  return (rows && rows[0] && Number(rows[0].cnt) > 0) || false;
}

// Helper: check if column exists in table
async function columnExists(tableName: string, columnName: string) {
  const [rows]: any = await pool.query(
    "SELECT COUNT(*) as cnt FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [tableName, columnName]
  );
  return (rows && rows[0] && Number(rows[0].cnt) > 0) || false;
}

// Utility: normalize a payslip raw db row into JS object with numbers
function normalizePayslipRow(r: any): {
  id: string | null;
  employee_id: string | null;
  employee_name: string;
  employee_role: string;
  month: number;
  year: number;
  teaching_sessions: number;
  teaching_hours: number;
  hourly_rate: number;
  total_pay: number;
  paid_amount: number;
  status: string;
  created_at: any;
  updated_at: any;
} | null {
  if (!r) return null;
  const id = r.id || r.payslip_id || r.payslipId || null;
  return {
    id,
    employee_id: r.employee_id ?? r.employeeId ?? r.employeeIdStr ?? null,
    employee_name: r.employee_name ?? r.employeeName ?? r.name ?? "",
    employee_role: r.employee_role ?? r.employeeRole ?? r.role ?? "",
    month: Number(r.month || 0),
    year: Number(r.year || 0),
    teaching_sessions: Number(r.teaching_sessions ?? r.teachingSessions ?? 0),
    teaching_hours: Number(r.teaching_hours ?? r.teachingHours ?? 0) || 0,
    hourly_rate: Number(r.hourly_rate ?? r.hourlyRate ?? 0) || 0,
    total_pay: Number(r.total_pay ?? r.totalPay ?? 0) || 0,
    paid_amount: Number(r.paid_amount ?? r.paidAmount ?? 0) || 0,
    status: r.status ?? "Chưa thanh toán",
    created_at: r.created_at ?? r.createdAt ?? null,
    updated_at: r.updated_at ?? r.updatedAt ?? null,
  };
}

// Ensure tables minimally exist (non-fatal)
async function ensureTablesExist() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS payslips (
      id VARCHAR(128) PRIMARY KEY,
      employee_id VARCHAR(128),
      employee_name VARCHAR(255),
      employee_role VARCHAR(100),
      month TINYINT,
      year SMALLINT,
      teaching_sessions INT DEFAULT 0,
      teaching_hours DECIMAL(14,4) DEFAULT 0,
      hourly_rate DECIMAL(14,2) DEFAULT 0,
      total_pay DECIMAL(14,2) DEFAULT 0,
      paid_amount DECIMAL(14,2) DEFAULT 0,
      status VARCHAR(50) DEFAULT 'Chưa thanh toán',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS payslip_payments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      payslip_id VARCHAR(100) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      method VARCHAR(50),
      reference VARCHAR(200),
      note TEXT,
      paid_by VARCHAR(100),
      paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (payslip_id)
    )`);
  } catch (err: any) {
    console.warn("[payslips] ensureTablesExist warning:", err?.message || err);
  }
}
ensureTablesExist().catch((e: any) => {
  console.warn(
    "[payslips] ensureTablesExist failed (non-fatal):",
    e?.message || e
  );
});

// Email transporter helper (optional)
function getEmailTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
}

async function sendPaymentReceiptEmail(
  toEmail: string,
  payslip: any,
  payment: any
) {
  try {
    const transporter = getEmailTransporter();
    if (!transporter) {
      console.info("[payslips] SMTP not configured — skipping email");
      return;
    }
    const subject = `Biên nhận thanh toán — ${payslip.employee_name || ""} (${payslip.month}/${payslip.year})`;
    const html = `
      <p>Xin chào ${payslip.employee_name || ""},</p>
      <p>Chúng tôi đã ghi nhận thanh toán:</p>
      <ul>
        <li>Số tiền: ${Number(payment.amount || 0)}</li>
        <li>Phương thức: ${payment.method || "—"}</li>
        <li>Tham chiếu: ${payment.reference || "—"}</li>
        <li>Ghi chú: ${payment.note || "—"}</li>
      </ul>
      <p>Trân trọng,<br/>Đội ngũ RTE</p>
    `;
    await transporter.sendMail({
      from:
        process.env.SMTP_FROM ||
        `no-reply@${process.env.SMTP_HOST || "example.com"}`,
      to: toEmail,
      subject,
      html,
    });
  } catch (e: any) {
    console.error(
      "[payslips] sendPaymentReceiptEmail failed (non-fatal):",
      e?.message || e
    );
  }
}

/**
 * Helper: compute teaching sessions & hours for an employee in a month
 * - Uses staff_attendance (status='PRESENT') as session count
 * - Tries to use teaching_logs duration for hours (if start_time & end_time present)
 * - Fallback: uses defaultSessionHours (1.5)
 */
async function computeAttendanceMetrics(
  employeeId: string,
  month: number,
  year: number
) {
  // date range
  const monthStr = String(month).padStart(2, "0");
  const start = `${year}-${monthStr}-01`;
  // compute end of month using MySQL LAST_DAY:
  const [rowsDuration]: any = await pool.query(
    `SELECT 
       COUNT(sa.session_id) AS sessions_count
     FROM staff_attendance sa
     WHERE sa.employee_id = ? AND sa.status = 'PRESENT' AND MONTH(sa.date)=? AND YEAR(sa.date)=?`,
    [employeeId, month, year]
  );
  const sessions =
    (rowsDuration &&
      rowsDuration[0] &&
      Number(rowsDuration[0].sessions_count)) ||
    0;

  // compute duration via teaching_logs if exists
  const hasTeachingLogs = await tableExists("teaching_logs");
  let hours = 0;
  if (hasTeachingLogs) {
    // prefer start_time/end_time
    const [durRows]: any = await pool.query(
      `SELECT SUM(
         IF(
           start_time IS NOT NULL AND end_time IS NOT NULL,
           TIMESTAMPDIFF(MINUTE, start_time, end_time)/60,
           0
         )
       ) AS total_hours
       FROM teaching_logs
       WHERE teacher_id = ? AND MONTH(date)=? AND YEAR(date)=?`,
      [employeeId, month, year]
    );
    hours = (durRows && durRows[0] && Number(durRows[0].total_hours)) || 0;
    // if teaching_logs exist but hours==0, fallback to sessions*default
    if (!hours && sessions) {
      hours = sessions * 1.5; // default session length
    }
  } else {
    // no teaching_logs table: estimate hours = sessions * defaultSessionHours
    hours = sessions * 1.5;
  }
  return { sessions: Number(sessions || 0), hours: Number(hours || 0) };
}

/**
 * POST /api/payslips/run
 * body: { month, year, force? }
 * - compute payslips for employees with hourly_rate > 0 OR TEACHER/TA
 */
router.post(
  "/run",
  requireAuth,
  requirePermission("RUN_PAYROLL"),
  async (req, res) => {
    const { month, year, force } = req.body || {};
    if (!month || !year)
      return res.status(400).json({ message: "month and year required" });

    const conn: any = await (pool as any).getConnection();
    try {
      await conn.beginTransaction();

      // get employees to process: those with hourly_rate>0 OR role TEACHER/TA
      const [emps]: any = await conn.query(
        `SELECT id, name, role, hourly_rate FROM employees WHERE (hourly_rate IS NOT NULL AND hourly_rate > 0) OR role IN ('TEACHER','TA')`
      );

      if (!emps || emps.length === 0) {
        await conn.commit();
        conn.release();
        return res.json({
          success: true,
          created: 0,
          message: "No eligible employees",
        });
      }

      // if not force and payslips exist -> return 400
      const [existing]: any = await conn.query(
        `SELECT COUNT(*) as cnt FROM payslips WHERE month=? AND year=?`,
        [month, year]
      );
      const existingCount =
        (existing && existing[0] && Number(existing[0].cnt)) || 0;
      if (existingCount > 0 && !force) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({
          message: `Payslips cho ${month}/${year} đã tồn tại. Gửi force=true để ghi đè.`,
        });
      }

      if (existingCount > 0 && force) {
        // delete existing payslips and related payments (best-effort)
        // use JOIN deletion to avoid issues with subqueries in some MySQL modes
        await conn.query(
          `DELETE p FROM payslip_payments p
           INNER JOIN payslips s ON p.payslip_id = s.id
           WHERE s.month = ? AND s.year = ?`,
          [month, year]
        );
        await conn.query(`DELETE FROM payslips WHERE month=? AND year=?`, [
          month,
          year,
        ]);
      }

      let created = 0;
      for (const e of emps) {
        const empId = String(e.id);
        const empName = e.name || "";
        const empRole = e.role || "";

        // compute sessions & hours
        const { sessions, hours } = await computeAttendanceMetrics(
          empId,
          month,
          year
        );

        // decide hourly_rate: prefer hourly_rate from employees table, fallback to 0
        const hourlyRate = Number(e.hourly_rate || 0) || 0;
        const totalPay = Number(hours * hourlyRate || 0);

        const id = uuidv4();
        await conn.query(
          `INSERT INTO payslips (id, employee_id, employee_name, employee_role, month, year, teaching_sessions, teaching_hours, hourly_rate, total_pay, paid_amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Chưa thanh toán', NOW())`,
          [
            id,
            empId,
            empName,
            empRole,
            month,
            year,
            sessions,
            hours,
            hourlyRate,
            totalPay,
          ]
        );
        created++;
      }

      await conn.commit();
      conn.release();

      res.json({
        success: true,
        created,
        message: `Payslips created for ${month}/${year}`,
      });
    } catch (err: any) {
      console.error("POST /api/payslips/run error", err?.message || err);
      try {
        await conn.rollback();
      } catch (e: any) {}
      try {
        conn.release();
      } catch (e: any) {}
      res.status(500).json({
        message: "Lỗi khi chạy payroll",
        error: err?.message || String(err),
      });
    }
  }
);

/**
 * GET /api/payslips
 * query: month, year, page, limit
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const qMonth = req.query.month ? Number(req.query.month) : null;
    const qYear = req.query.year ? Number(req.query.year) : null;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const offset = (page - 1) * limit;

    let where = "WHERE 1=1";
    const params: any[] = [];
    if (qMonth) {
      where += " AND month=?";
      params.push(qMonth);
    }
    if (qYear) {
      where += " AND year=?";
      params.push(qYear);
    }

    // count
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as cnt FROM payslips ${where}`,
      params
    );
    const total = (countRows && countRows[0] && Number(countRows[0].cnt)) || 0;

    const [rows]: any = await pool.query(
      `SELECT * FROM payslips ${where} ORDER BY COALESCE(created_at, updated_at, '1970-01-01') DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const normalized = (rows || []).map(normalizePayslipRow);
    res.json({ rows: normalized, total, page, limit });
  } catch (err: any) {
    console.error("GET /api/payslips error", err?.message || err);
    res.status(500).json({
      message: "Lỗi khi lấy payslips",
      error: err?.message || String(err),
    });
  }
});

/**
 * GET /api/payslips/:id
 */
router.get("/:id", requireAuth, async (req, res) => {
  const id = req.params.id;
  try {
    // try find by id or payslip_id
    const [rows]: any = await pool.query(
      `SELECT * FROM payslips WHERE id = ? LIMIT 1`,
      [id]
    );
    const raw = (rows && rows[0]) || null;
    if (!raw) return res.status(404).json({ message: "Payslip không tìm thấy" });

    const payslip = normalizePayslipRow(raw)!; // safe because raw exists

    // payments - choose order column depending on schema
    const payOrder = (await columnExists("payslip_payments", "created_at"))
      ? "created_at DESC"
      : (await columnExists("payslip_payments", "paid_at"))
      ? "paid_at DESC"
      : "id DESC";

    const [payments]: any = await pool.query(
      `SELECT * FROM payslip_payments WHERE payslip_id = ? ORDER BY ${payOrder}`,
      [payslip.id]
    );

    const normalizedPayments = (payments || []).map((p: any) => ({
      ...p,
      amount: Number(p.amount || 0),
      created_at: p.created_at || p.paid_at || null,
    }));

    res.json({ payslip, payments: normalizedPayments });
  } catch (err: any) {
    console.error("GET /api/payslips/:id error", err?.message || err);
    res
      .status(500)
      .json({ message: "Lỗi server", error: err?.message || String(err) });
  }
});

/**
 * POST /api/payslips/:id/pay
 * body: { amount, method, reference, note, created_by }
 */
router.post(
  "/:id/pay",
  requireAuth,
  requirePermission("RUN_PAYROLL"),
  async (req, res) => {
    const payslipIdParam = req.params.id;
    const { amount, method, reference, note, created_by } = req.body || {};
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ message: "amount required" });

    const conn: any = await (pool as any).getConnection();
    try {
      await conn.beginTransaction();

      // find payslip (try both id and payslip_id)
      const [rows]: any = await conn.query(
        `SELECT * FROM payslips WHERE id = ? OR payslip_id = ? LIMIT 1`,
        [payslipIdParam, payslipIdParam]
      );
      const raw = (rows && rows[0]) || null;
      if (!raw) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ message: "Payslip không tìm thấy" });
      }
      const payslip = normalizePayslipRow(raw)!; // safe because raw exists

      // --- determine whether payslip_payments.id is AUTO_INCREMENT ---
      const [idColRows]: any = await conn.query(
        `SELECT EXTRA 
         FROM information_schema.columns 
         WHERE table_schema = DATABASE() 
           AND table_name = 'payslip_payments' 
           AND column_name = 'id'`
      );
      const hasAutoIncId =
        idColRows &&
        idColRows[0] &&
        typeof idColRows[0].EXTRA === "string" &&
        idColRows[0].EXTRA.toLowerCase().includes("auto_increment");

      // ensure payslip_payments table exists? (defensive)
      const [tbl]: any = await conn.query(
        `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'payslip_payments'`
      );
      if (!(tbl && tbl[0] && Number(tbl[0].cnt) > 0)) {
        await conn.query(
          `CREATE TABLE IF NOT EXISTS payslip_payments (
             id BIGINT AUTO_INCREMENT PRIMARY KEY,
             payslip_id VARCHAR(128) NOT NULL,
             amount DECIMAL(12,2) NOT NULL,
             method VARCHAR(50),
             reference VARCHAR(200),
             note TEXT,
             paid_by VARCHAR(100),
             paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             INDEX (payslip_id)
           )`
        );
      }

      // --- insert payment record (handle both schemas) ---
      if (hasAutoIncId) {
        await conn.query(
          `INSERT INTO payslip_payments 
            (payslip_id, amount, method, reference, note, paid_by, paid_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [
            payslip.id,
            Number(amount || 0),
            method || "OTHER",
            reference || null,
            note || null,
            created_by || null,
          ]
        );
      } else {
        const paymentId = uuidv4();
        await conn.query(
          `INSERT INTO payslip_payments 
            (id, payslip_id, amount, method, reference, note, paid_by, paid_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            paymentId,
            payslip.id,
            Number(amount || 0),
            method || "OTHER",
            reference || null,
            note || null,
            created_by || null,
          ]
        );
      }

      // --- compute new total paid for this payslip ---
      const [sumRows]: any = await conn.query(
        `SELECT SUM(amount) as tot FROM payslip_payments WHERE payslip_id = ?`,
        [payslip.id]
      );
      const totalPaid = Number(sumRows && sumRows[0] && sumRows[0].tot) || 0;

      // determine status
      const totalPayVal = Number(payslip.total_pay || 0);
      const newStatus =
        totalPayVal > 0 && totalPaid >= totalPayVal
          ? "Đã thanh toán"
          : "Chưa thanh toán";

      await conn.query(
        `UPDATE payslips SET paid_amount = ?, status = ?, updated_at = NOW() WHERE id = ?`,
        [totalPaid, newStatus, payslip.id]
      );

      // fetch updated payslip
      const [uRows]: any = await conn.query(
        `SELECT * FROM payslips WHERE id = ? LIMIT 1`,
        [payslip.id]
      );
      const updatedPayslipRaw = (uRows && uRows[0]) || null;
      const updatedPayslip = normalizePayslipRow(updatedPayslipRaw) || null;

      // choose payment ordering column depending on schema
      const payOrder = (await columnExists("payslip_payments", "created_at"))
        ? "created_at DESC"
        : (await columnExists("payslip_payments", "paid_at"))
        ? "paid_at DESC"
        : "id DESC";

      const [paymentsRows]: any = await conn.query(
        `SELECT * FROM payslip_payments WHERE payslip_id = ? ORDER BY ${payOrder}`,
        [payslip.id]
      );

      // send receipt email if employee email is available (non-fatal)
      try {
        let empEmail = null;
        if (updatedPayslip && updatedPayslip.employee_id) {
          const [eR]: any = await conn.query(
            `SELECT email FROM employees WHERE id = ? LIMIT 1`,
            [updatedPayslip.employee_id]
          );
          if (eR && eR[0] && eR[0].email) empEmail = eR[0].email;
        }
        if (empEmail) {
          const lastPayment =
            paymentsRows && paymentsRows[0]
              ? {
                  ...paymentsRows[0],
                  amount: Number(paymentsRows[0].amount || 0),
                }
              : null;
          if (lastPayment) {
            await sendPaymentReceiptEmail(empEmail, updatedPayslip, lastPayment);
          }
        }
      } catch (e: any) {
        console.error("[payslips] send receipt non-fatal:", e?.message || e);
      }

      await conn.commit();
      conn.release();

      res.json({
        success: true,
        payslip: updatedPayslip,
        payments: (paymentsRows || []).map((pp: any) => ({
          ...pp,
          amount: Number(pp.amount || 0),
          created_at: pp.created_at || pp.paid_at || null,
        })),
      });
    } catch (err: any) {
      console.error("POST /api/payslips/:id/pay error", err?.message || err);
      try {
        await conn.rollback();
      } catch (e: any) {}
      try {
        conn.release();
      } catch (e: any) {}
      res.status(500).json({
        message: "Lỗi khi lưu payment",
        error: err?.message || String(err),
      });
    }
  }
);

/**
 * POST /api/payslips/:id/recalculate
 * Recompute teaching_sessions, teaching_hours and total_pay for a single payslip,
 * using computeAttendanceMetrics logic.
 */
router.post(
  "/:id/recalculate",
  requireAuth,
  requirePermission("RUN_PAYROLL"),
  async (req, res) => {
    const idParam = req.params.id;
    const conn: any = await (pool as any).getConnection();
    try {
      await conn.beginTransaction();

      const [rows]: any = await conn.query(
        `SELECT * FROM payslips WHERE id=? LIMIT 1`,
        [idParam]
      );
      const raw = (rows && rows[0]) || null;
      if (!raw) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ message: "Payslip không tìm thấy" });
      }
      const payslip = normalizePayslipRow(raw)!;
      if (!payslip.employee_id) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ message: "Payslip không có employee_id" });
      }
      const { sessions, hours } = await computeAttendanceMetrics(
        payslip.employee_id,
        payslip.month,
        payslip.year
      );
      const hourly = Number(payslip.hourly_rate || 0);
      const totalPay = Number(hours * hourly || 0);

      await conn.query(
        `UPDATE payslips SET teaching_sessions=?, teaching_hours=?, total_pay=?, updated_at = NOW() WHERE id = ?`,
        [sessions, hours, totalPay, payslip.id]
      );

      // fetch updated
      const [uRows]: any = await conn.query(
        `SELECT * FROM payslips WHERE id = ? LIMIT 1`,
        [payslip.id]
      );
      const updated = normalizePayslipRow((uRows && uRows[0]) || null);

      await conn.commit();
      conn.release();

      res.json({ success: true, payslip: updated });
    } catch (err: any) {
      console.error("POST /api/payslips/:id/recalculate error", err?.message || err);
      try {
        await conn.rollback();
      } catch (e: any) {}
      try {
        conn.release();
      } catch (e: any) {}
      res.status(500).json({
        message: "Lỗi khi tính lại payslip",
        error: err?.message || String(err),
      });
    }
  }
);

/**
 * GET /api/payslips/:id/pdf
 * Return application/pdf buffer. Simple PDF (server-side PDFKit).
 */
router.get("/:id/pdf", requireAuth, async (req, res) => {
  const idParam = req.params.id;
  try {
    const [rows]: any = await pool.query(
      `SELECT * FROM payslips WHERE id=? LIMIT 1`,
      [idParam]
    );
    const raw = (rows && rows[0]) || null;
    if (!raw)
      return res.status(404).json({ message: "Payslip không tìm thấy" });

    const payslip = normalizePayslipRow(raw)!;

    const [payslipPayments]: any = await pool.query(
      `SELECT * FROM payslip_payments WHERE payslip_id = ? ORDER BY paid_at DESC`,
      [payslip.id]
    );

    // generate pdf
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const writableBuffer = new streamBuffers.WritableStreamBuffer();

    doc.fontSize(18).text("Payslip / Phiếu lương", { align: "center" });
    doc.moveDown();
    doc
      .fontSize(12)
      .text(`Nhân viên: ${payslip.employee_name} (${payslip.employee_id})`);
    doc.text(`Vai trò: ${payslip.employee_role || "-"}`);
    doc.text(`Kỳ: ${String(payslip.month).padStart(2, "0")}/${payslip.year}`);
    doc.moveDown();
    doc.text(`Số buổi: ${payslip.teaching_sessions}`);
    doc.text(`Tổng giờ: ${Number(payslip.teaching_hours).toFixed(2)} giờ`);
    doc.text(`Lương/giờ: ${Number(payslip.hourly_rate).toFixed(2)} ₫`);
    doc.text(`Tổng lương: ${Number(payslip.total_pay).toFixed(2)} ₫`);
    doc.text(`Đã thanh toán: ${Number(payslip.paid_amount).toFixed(2)} ₫`);
    doc.text(`Trạng thái: ${payslip.status}`);
    doc.moveDown();

    if (payslipPayments && payslipPayments.length) {
      doc.text("Payments:", { underline: true });
      for (const p of payslipPayments) {
        doc.text(
          `- ${p.method || "—"} | ${Number(p.amount || 0).toFixed(2)} | ${
            p.reference || ""
          } | ${p.note || ""}`
        );
      }
    }

    doc.end();
    doc.pipe(writableBuffer);
    writableBuffer.on("finish", () => {
      const buf = writableBuffer.getContents();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="payslip-${
          payslip.employee_id || payslip.id
        }.pdf"`
      );
      res.send(buf);
    });
  } catch (err: any) {
    console.error("GET /api/payslips/:id/pdf error", err?.message || err);
    res
      .status(500)
      .json({ message: "Lỗi khi tạo PDF", error: err?.message || String(err) });
  }
});

/**
 * DELETE /api/payslips/:id
 */
router.delete(
  "/:id",
  requireAuth,
  requirePermission("RUN_PAYROLL"),
  async (req, res) => {
    const idParam = req.params.id;
    const conn: any = await (pool as any).getConnection();
    try {
      await conn.beginTransaction();
      const [rows]: any = await conn.query(
        `SELECT id FROM payslips WHERE id=? LIMIT 1`,
        [idParam]
      );
      const raw = (rows && rows[0]) || null;
      if (!raw) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ message: "Payslip không tìm thấy" });
      }
      const payslipId = raw.id;
      await conn.query(`DELETE FROM payslip_payments WHERE payslip_id = ?`, [
        payslipId,
      ]);
      const [result]: any = await conn.query(
        `DELETE FROM payslips WHERE id = ?`,
        [payslipId]
      );
      await conn.commit();
      conn.release();
      if (result && result.affectedRows === 0) {
        return res.status(404).json({ message: "Payslip không tìm thấy" });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("DELETE /api/payslips/:id error", err?.message || err);
      try {
        await conn.rollback();
      } catch (e: any) {}
      try {
        conn.release();
      } catch (e: any) {}
      res.status(500).json({
        message: "Lỗi khi xóa payslip",
        error: err?.message || String(err),
      });
    }
  }
);

export default router;
