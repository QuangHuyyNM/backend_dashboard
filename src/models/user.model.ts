// src/models/user.model.ts
import pool from '../db';

export type UserRecord = {
  id?: number;
  name: string;
  email: string;
  password: string; // hashed
  role: string;
  status: string;
};

export const findUserByEmail = async (email: string) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  // @ts-ignore
  return rows[0] || null;
};

export const createUser = async (user: UserRecord) => {
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password, role, status) VALUES (?,?,?,?,?)',
    [user.name, user.email, user.password, user.role, user.status]
  );
  // @ts-ignore
  return result.insertId;
};
