// src/routes/auth.ts
import { Router } from "express";
import jwt from "jsonwebtoken";

const router = Router();

// dùng chung 1 JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET || "secret-dev";

// quick test user
const testUsers: Record<string, any> = {
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
  const token = jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

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

export default router;
