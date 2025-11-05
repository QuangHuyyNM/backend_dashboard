"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/seed-admin.ts
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = __importDefault(require("./db"));
async function seed() {
    try {
        const email = 'admin@local';
        const [rows] = await db_1.default.query('SELECT id FROM users WHERE email = ?', [email]);
        // @ts-ignore
        if (rows.length > 0) {
            console.log('Admin already exists.');
            process.exit(0);
        }
        const hashed = await bcryptjs_1.default.hash('admin', 10); // mật khẩu: admin
        await db_1.default.query('INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)', [
            'Admin RTE',
            email,
            hashed,
            'CEO', // role mặc định theo demo
            'ACTIVE',
        ]);
        console.log('Admin created: admin@local / admin');
        process.exit(0);
    }
    catch (err) {
        console.error(err);
        process.exit(1);
    }
}
seed();
