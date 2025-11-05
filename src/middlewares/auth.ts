// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
export interface JwtPayloadMinimal {
  sub: string; // user id
  role?: string;
  email?: string;
  iat?: number;
  exp?: number;
}

// Middleware: verify JWT and attach user info to req.user
export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: missing token" });
    }
    const token = auth.slice("Bearer ".length).trim();

    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET) as JwtPayloadMinimal;
    } catch (err) {
      return res.status(401).json({ message: "Unauthorized: invalid token" });
    }

    // attach a lightweight user object to req
    (req as any).user = {
      id: String(payload.sub),
      role: payload.role || null,
      email: payload.email || null,
    };

    next();
  } catch (err) {
    console.error("authMiddleware error:", err);
    res.status(500).json({ message: "Auth middleware error" });
  }
};

// Factory middleware: require one or more roles
export const requireRole = (allowed: string | string[]) => {
  const allowedArr = Array.isArray(allowed) ? allowed : [allowed];
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!user.role || !allowedArr.includes(user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    }
    next();
  };
};

// Utility: sign token (use in login)
export const signToken = (
  payload: { sub: string; role?: string; email?: string },
  expiresIn = "7d"
) => {
  return jwt.sign(payload as any, JWT_SECRET, { expiresIn });
};
export const requirePermission = (permission: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    console.debug("[auth] requirePermission check", {
      permission,
      user,
      url: req.url,
    });
    if (!user) return res.status(401).json({ message: "Not authenticated" });

    if (
      Array.isArray(user.permissions) &&
      user.permissions.includes(permission)
    ) {
      console.info("[auth] Granted by explicit permission", { permission });
      return next();
    }

    if (user.role && ROLE_ALLOW_FOR_PERMISSION.includes(user.role)) {
      console.info("[auth] Granted by role fallback", {
        role: user.role,
        permission,
      });
      return next();
    }

    console.warn("[auth] Permission denied", {
      permission,
      permissions: user.permissions,
      role: user.role,
    });
    return res.status(403).json({ message: "Truy cập bị từ chối" });
  };
};
