// src/seed-admin.ts
import dotenv from 'dotenv';
dotenv.config();
import bcrypt from 'bcryptjs';
import pool from './db';

async function seed() {
  try {
    const email = 'admin@local';
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    // @ts-ignore
    if (rows.length > 0) {
      console.log('Admin already exists.');
      process.exit(0);
    }

    const hashed = await bcrypt.hash('admin', 10); // mật khẩu: admin
    await pool.query('INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)', [
      'Admin RTE',
      email,
      hashed,
      'CEO', // role mặc định theo demo
      'ACTIVE',
    ]);
    console.log('Admin created: admin@local / admin');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seed();
