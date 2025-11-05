// scripts/migrateCEO.ts
import pool from "../db"; // Nếu db.ts nằm ở thư mục src

import bcrypt from "bcrypt";

async function migrateCEO() {
  try {
    const [rows] = await pool.query("SELECT * FROM employees WHERE role = 'CEO'");
    const ceos = rows as any[];
    if (!ceos.length) {
      console.log("No CEO found in employees");
      return;
    }

    for (const ceo of ceos) {
      const username = ceo.email.split("@")[0];
      const passwordHash = await bcrypt.hash("ChangeMe123!", 10); // default pw, sau đổi
      
      // Insert into system_users
      await pool.query(
        `INSERT INTO system_users (username,password_hash,name,role,email)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           name=VALUES(name),
           role=VALUES(role),
           email=VALUES(email)`,
        [username, passwordHash, ceo.name, "CEO", ceo.email]
      );

      // Remove from employees
      await pool.query("DELETE FROM employees WHERE id = ?", [ceo.id]);
      console.log(`CEO ${ceo.name} migrated to system_users`);
    }
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    pool.end();
  }
}

migrateCEO();
