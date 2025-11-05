"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promise_1 = __importDefault(require("mysql2/promise"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
console.log('DB_HOST:', process.env.DB_HOST); // Kiểm tra DB_HOST
console.log('DB_USER:', process.env.DB_USER); // Kiểm tra DB_USER
console.log('DB_PASS:', process.env.DB_PASS); // Kiểm tra DB_PASS
console.log('DB_NAME:', process.env.DB_NAME); // Kiểm tra DB_NAME
const pool = promise_1.default.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    connectionLimit: 10,
});
exports.default = pool;
