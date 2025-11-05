"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/migrateCEO.ts
const db_1 = __importDefault(require("../db")); // Nếu db.ts nằm ở thư mục src
const bcrypt_1 = __importDefault(require("bcrypt"));
async function migrateCEO() {
    try {
        const [rows] = await db_1.default.query("SELECT * FROM employees WHERE role = 'CEO'");
        const ceos = rows;
        if (!ceos.length) {
            console.log("No CEO found in employees");
            return;
        }
        for (const ceo of ceos) {
            const username = ceo.email.split("@")[0];
            const passwordHash = await bcrypt_1.default.hash("ChangeMe123!", 10); // default pw, sau đổi
            // Insert into system_users
            await db_1.default.query(`INSERT INTO system_users (username,password_hash,name,role,email)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           name=VALUES(name),
           role=VALUES(role),
           email=VALUES(email)`, [username, passwordHash, ceo.name, "CEO", ceo.email]);
            // Remove from employees
            await db_1.default.query("DELETE FROM employees WHERE id = ?", [ceo.id]);
            console.log(`CEO ${ceo.name} migrated to system_users`);
        }
    }
    catch (err) {
        console.error("Migration failed:", err);
    }
    finally {
        db_1.default.end();
    }
}
migrateCEO();
