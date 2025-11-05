"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signin = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const user_model_1 = require("../models/user.model");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const signin = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ message: 'Thiếu email hoặc password' });
        const user = await (0, user_model_1.findUserByEmail)(email);
        if (!user)
            return res.status(401).json({ message: 'Người dùng không tồn tại' });
        const match = await bcryptjs_1.default.compare(password, user.password);
        if (!match)
            return res.status(401).json({ message: 'Sai mật khẩu' });
        const payload = { id: user.id, email: user.email, role: user.role };
        const token = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '8h' });
        // trả về token và thông tin user (không trả password)
        const { password: _, ...userSafe } = user;
        return res.json({ accessToken: token, user: userSafe });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Lỗi server' });
    }
};
exports.signin = signin;
