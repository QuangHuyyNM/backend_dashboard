// src/controllers/auth.controller.ts
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { findUserByEmail, UserRecord } from '../models/user.model';
import dotenv from 'dotenv';
dotenv.config();

export const signin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Thiếu email hoặc password' });

    const user: any = await findUserByEmail(email);
    if (!user) return res.status(401).json({ message: 'Người dùng không tồn tại' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Sai mật khẩu' });

    const payload = { id: user.id, email: user.email, role: user.role };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '8h' });

    // trả về token và thông tin user (không trả password)
    const { password: _, ...userSafe } = user;
    return res.json({ accessToken: token, user: userSafe });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
};
