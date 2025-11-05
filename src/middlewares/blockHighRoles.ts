// src/middlewares/blockHighRoles.ts
import { Request, Response, NextFunction } from "express";

const HIGH_ROLES = ["CEO", "Admin", "SUPERADMIN"]; // tùy theo tên roles của bạn

export function preventAssignHighRole(req: Request, res: Response, next: NextFunction) {
  // req.body.role là role đang cố gắng gán
  const requestedRole = (req.body?.role || "").toString();
  if (!requestedRole) return next();

  // nếu cố gắng gán role cao và caller không có quyền (ví dụ req.user.role !== 'CEO') -> block
  const caller = (req as any).user;
  if (HIGH_ROLES.includes(requestedRole)) {
    if (!caller) {
      return res.status(403).json({ message: "Không có quyền gán role này" });
    }
    // chỉ cho phép caller có chính role CEO mới gán CEO (hoặc bạn có policy khác)
    if (caller.role !== "CEO") {
      return res.status(403).json({ message: "Chỉ CEO mới có thể gán vai trò cao" });
    }
  }
  next();
}
