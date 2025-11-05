import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

console.log('DB_HOST:', process.env.DB_HOST);  // Kiểm tra DB_HOST
console.log('DB_USER:', process.env.DB_USER);  // Kiểm tra DB_USER
console.log('DB_PASS:', process.env.DB_PASS);  // Kiểm tra DB_PASS
console.log('DB_NAME:', process.env.DB_NAME);  // Kiểm tra DB_NAME

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  connectionLimit: 10,
});

export default pool;
