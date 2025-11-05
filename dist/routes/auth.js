"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/auth.ts
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const router = (0, express_1.Router)();
// dùng chung 1 JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET || "secret-dev";
// quick test user
const testUsers = {
    "admin@local": {
        id: "RTE000",
        email: "admin@local",
        name: "Administrator",
        role: "CEO",
        password: "admin",
    },
};
router.post("/login", (req, res) => {
    const { email, password } = req.body || {};
    console.log("/api/auth/login received:", req.body);
    if (!email || !password) {
        return res.status(400).json({ message: "Email và mật khẩu là bắt buộc" });
    }
    const user = testUsers[email];
    if (!user || user.password !== password) {
        return res.status(400).json({ message: "Sai email hoặc mật khẩu" });
    }
    // tạo JWT đúng secret
    const token = jsonwebtoken_1.default.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({
        accessToken: token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            profilePictureUrl: "",
        },
    });
});
exports.default = router;
