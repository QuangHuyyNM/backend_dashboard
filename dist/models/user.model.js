"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUser = exports.findUserByEmail = void 0;
// src/models/user.model.ts
const db_1 = __importDefault(require("../db"));
const findUserByEmail = async (email) => {
    const [rows] = await db_1.default.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    // @ts-ignore
    return rows[0] || null;
};
exports.findUserByEmail = findUserByEmail;
const createUser = async (user) => {
    const [result] = await db_1.default.query('INSERT INTO users (name, email, password, role, status) VALUES (?,?,?,?,?)', [user.name, user.email, user.password, user.role, user.status]);
    // @ts-ignore
    return result.insertId;
};
exports.createUser = createUser;
