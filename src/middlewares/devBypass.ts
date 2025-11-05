// src/middlewares/devBypass.ts
import { Request, Response, NextFunction } from "express";

export const devBypass = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.SKIP_AUTH === "true") {
    // giả lập user cho tất cả request
    (req as any).user = { id: "RTE000", role: "CEO", email: "admin@local" };
    console.log("[devBypass] Request bypassed:", req.url);
    return next();
  }
  next();
};
