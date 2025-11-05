// src/workers/reminderWorker.ts
import pool from "../db";

/**
 * Simple reminder worker:
 * - Run daily (or hourly) to:
 *   - Find invoices due in 7,3,1 days -> create reminder log (DAYS_7/DAYS_3/DAYS_1).
 *   - Find invoices overdue (due_date < CURDATE() and status IN (UNPAID, PARTIAL)) -> create OVERDUE reminder.
 * - This implementation only logs reminders to invoice_reminder_logs and prints to console.
 * - In production, integrate with email/SMS provider or push notification system.
 */

export async function runRemindersOnce() {
  try {
    // days array: days ahead to remind
    const remindDays = [7, 3, 1];
    for (const d of remindDays) {
      const [rows]: any = await pool.query(`
        SELECT i.id, i.invoice_number, i.student_id, i.due_date, i.total_amount, i.paid_amount
        FROM invoices i
        WHERE i.status IN ('UNPAID','PARTIAL') AND i.due_date IS NOT NULL AND i.due_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)
      `, [d]);
      for (const r of rows || []) {
        await pool.query("INSERT INTO invoice_reminder_logs (invoice_id, reminder_type, channel, details) VALUES (?, ?, 'INAPP', ?)", [r.id, `DAYS_${d}`, JSON.stringify({ invoice_number: r.invoice_number })]);
        console.info(`[reminderWorker] queued DAYS_${d} reminder for invoice ${r.invoice_number}`);
        // TODO: call external email/sms send here
      }
    }

    // overdue
    const [overRows]: any = await pool.query(`
      SELECT i.id, i.invoice_number, i.student_id, i.due_date, i.total_amount, i.paid_amount
      FROM invoices i
      WHERE i.status IN ('UNPAID','PARTIAL') AND i.due_date IS NOT NULL AND i.due_date < CURDATE()
    `);
    for (const r of overRows || []) {
      await pool.query("INSERT INTO invoice_reminder_logs (invoice_id, reminder_type, channel, details) VALUES (?, 'OVERDUE', 'INAPP', ?)", [r.id, JSON.stringify({ invoice_number: r.invoice_number })]);
      console.info(`[reminderWorker] queued OVERDUE reminder for invoice ${r.invoice_number}`);
      // TODO: escalations: notify finance + cskh
    }

  } catch (err:any) {
    console.error("[reminderWorker] error:", err);
  }
}

// helper to start periodic worker
export function startReminderWorker(intervalMs = 1000 * 60 * 60) { // hourly default
  // run once at startup
  runRemindersOnce().catch((e)=>console.error(e));
  // then periodic
  setInterval(() => {
    runRemindersOnce().catch((e)=>console.error(e));
  }, intervalMs);
}
