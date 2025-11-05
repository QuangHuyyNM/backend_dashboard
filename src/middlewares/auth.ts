import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const SECRET =
  process.env.JWT_SECRET ||
  process.env.DEV_JWT_SECRET ||
  "dev-secret-CHANGE_ME";

const ROLE_ALLOW_FOR_PERMISSION: string[] = (
  process.env.ROLE_ALLOW_FOR_PERMISSION || "ADMISSIONS,ADMIN,CEO,DEVELOPER"
)
  .split(",")
  .map((r) => r.trim().toUpperCase())
  .filter(Boolean);

export interface AuthPayload extends JwtPayload {
  id: string;
  role?: string;
  name?: string;
  permissions?: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}

function tryParseDevUser(header?: string): AuthPayload | null {
  if (!header) return null;
  try {
    if (header.includes(":") && !header.trim().startsWith("{")) {
      const [id, role, name] = header.split(":").map((s) => s.trim());
      const u: AuthPayload = { id: id || "dev-user", role, name };
      console.debug("[auth] parsed short dev user ->", u);
      return u;
    }
    const p = JSON.parse(header);
    if (p && typeof p === "object") {
      const u: AuthPayload = {
        id: (p.id && String(p.id)) || "dev-user",
        role: p.role,
        name: p.name,
        permissions: Array.isArray(p.permissions) ? p.permissions : undefined,
      };
      console.debug("[auth] parsed json dev user ->", u);
      return u;
    }
  } catch (e) {
    console.warn("[auth] tryParseDevUser parse failed", e);
  }
  return null;
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const authReq = req as AuthenticatedRequest;
  const authHeader = (req.headers.authorization ||
    (req.headers as any)["authorization"]) as string | undefined;

  if (!authHeader && process.env.NODE_ENV !== "production") {
    const devHeader = (req.headers["x-dev-user"] ||
      (req.headers as any)["x-dev-user"]) as string | undefined;
    const devUser = tryParseDevUser(devHeader || process.env.DEV_USER);
    if (devUser) {
      authReq.user = devUser;
      return next();
    }
  }

  if (!authHeader)
    return res.status(401).json({ message: "No token provided" });

  const parts = authHeader.split(" ");
  if (parts.length < 2 || parts[0].toLowerCase() !== "bearer") {
    return res.status(401).json({ message: "Malformed Authorization header" });
  }

  const token = parts[1];
  try {
    const decoded = jwt.verify(token, SECRET) as AuthPayload;
    if (decoded && decoded.id && typeof decoded.id !== "string")
      decoded.id = String(decoded.id);
    authReq.user = decoded;
    return next();
  } catch (err: any) {
    console.error("JWT verify error:", err);
    return res
      .status(401)
      .json({ message: "Invalid token", error: err?.message });
  }
};

export const requireRole = (roles: string[]) => {
  const handler: RequestHandler = (req, res, next) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    const role = (user.role || "").toString();
    if (!roles.includes(role))
      return res.status(403).json({ message: "Truy cập bị từ chối" });
    return next();
  };
  return handler;
};

export const verifyToken: RequestHandler = (req, res, next) => {
  const authReq = req as AuthenticatedRequest;
  const authHeader = (req.headers["authorization"] ||
    (req.headers as any)["Authorization"]) as string | undefined;
  if (!authHeader && process.env.NODE_ENV !== "production") {
    const devHeader = (req.headers["x-dev-user"] ||
      (req.headers as any)["x-dev-user"]) as string | undefined;
    const devUser = tryParseDevUser(devHeader || process.env.DEV_USER);
    if (devUser) {
      authReq.user = devUser;
      return next();
    }
  }
  if (!authHeader)
    return res.status(401).json({ message: "No token provided" });
  const parts = String(authHeader).split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return res.status(401).json({ message: "Malformed Authorization header" });
  }
  const token = parts[1];
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) {
      console.error("JWT verify error:", err);
      return res
        .status(401)
        .json({ message: "Token invalid", error: (err as Error).message });
    }
    const p = decoded as AuthPayload;
    if (p && p.id && typeof p.id !== "string") p.id = String(p.id);
    authReq.user = p;
    next();
  });
};

export const requirePermission = (permission: string) => {
  const handler: RequestHandler = (req, res, next) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    console.debug("[auth] requirePermission check", { permission, user });
    if (!user) return res.status(401).json({ message: "Not authenticated" });

    if (Array.isArray(user.permissions) && user.permissions.includes(permission)) {
      return next();
    }

    if (
      user.role &&
      ROLE_ALLOW_FOR_PERMISSION.includes((user.role || "").toString().toUpperCase())
    ) {
      console.info(
        "[auth] requirePermission: granting permission by role fallback",
        { role: user.role, permission }
      );
      return next();
    }

    console.warn("[auth] requirePermission denied", {
      permission,
      permissions: user.permissions,
      role: user.role,
    });
    return res.status(403).json({ message: "Truy cập bị từ chối" });
  };
  return handler;
};

export const authenticateToken = verifyToken;

export default {
  requireAuth,
  requireRole,
  verifyToken,
  authenticateToken,
  requirePermission,
};