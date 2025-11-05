import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const SECRET =
  process.env.JWT_SECRET ||
  process.env.DEV_JWT_SECRET ||
  "dev-secret-CHANGE_ME";

/**
 * ROLE_ALLOW_FOR_PERMISSION env variable can be a comma separated list.
 * We'll normalize by trimming and uppercasing.
 */
const ROLE_ALLOW_FOR_PERMISSION: string[] = (
  process.env.ROLE_ALLOW_FOR_PERMISSION || "ADMISSIONS,ADMIN,CEO,DEVELOPER"
)
  .split(",")
  .map((r) => r.trim().toUpperCase())
  .filter(Boolean);

// Types
export interface AuthPayload extends JwtPayload {
  id: string;
  role?: string;
  name?: string;
  permissions?: string[];
}

/**
 * AuthenticatedRequest - attach user payload after JWT verify
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}

/**
 * For compatibility with older imports that used `AuthedRequest`,
 * export a type alias so both names work.
 */
export type AuthedRequest = AuthenticatedRequest;

/**
 * Try to parse dev user from header or env:
 * - Accept JSON stringified object
 * - Or a short form "ID:ROLE:Name"
 */
function tryParseDevUser(header?: string): AuthPayload | null {
  if (!header) {
    return null;
  }
  try {
    // support simple "id:ROLE:Name" shorthand
    if (header.includes(":") && !header.trim().startsWith("{")) {
      const [id, role, name] = header.split(":").map((s) => s.trim());
      const u: AuthPayload = { id: id || "dev-user", role, name };
      console.debug("[auth] parsed short dev user ->", u);
      return u;
    }
    // try parse JSON string
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

/**
 * requireAuth middleware:
 * - In dev mode, allows x-dev-user header or process.env.DEV_USER JSON/shortstring
 * - Otherwise expects "Authorization: Bearer <token>"
 * - Validates JWT using SECRET and attaches payload to req.user
 */
export const requireAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = (req.headers.authorization ||
    req.headers["authorization"]) as string | undefined;

  // DEV fallback using x-dev-user header or DEV_USER env
  if (!authHeader && process.env.NODE_ENV !== "production") {
    const devHeader = (req.headers["x-dev-user"] ||
      req.headers["x-dev-user".toLowerCase()]) as string | undefined;
    const devUser = tryParseDevUser(devHeader || process.env.DEV_USER);
    if (devUser) {
      req.user = devUser;
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
    req.user = decoded;
    return next();
  } catch (err: any) {
    console.error("JWT verify error:", err);
    return res
      .status(401)
      .json({ message: "Invalid token", error: err?.message });
  }
};

/**
 * requireRole(roles[])
 * - roles: array of allowed roles (string matching exact role value in token)
 */
export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    const role = (user.role || "").toString();
    if (!roles.includes(role))
      return res.status(403).json({ message: "Truy cập bị từ chối" });
    return next();
  };
};

/**
 * verifyToken alias (callback-style)
 */
export const verifyToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = (req.headers["authorization"] ||
    req.headers["Authorization"]) as string | undefined;
  if (!authHeader && process.env.NODE_ENV !== "production") {
    const devHeader = (req.headers["x-dev-user"] ||
      req.headers["x-dev-user".toLowerCase()]) as string | undefined;
    const devUser = tryParseDevUser(devHeader || process.env.DEV_USER);
    if (devUser) {
      req.user = devUser;
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
    req.user = p;
    next();
  });
};

/**
 * requirePermission(permission)
 * - If token contains explicit permissions[] array, use it.
 * - Otherwise fallback to allow if user's role exists in ROLE_ALLOW_FOR_PERMISSION.
 */
export const requirePermission = (permission: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    console.debug("[auth] requirePermission check", { permission, user });
    if (!user) return res.status(401).json({ message: "Not authenticated" });

    // 1) explicit permissions array
    if (
      Array.isArray(user.permissions) &&
      user.permissions.includes(permission)
    ) {
      return next();
    }

    // 2) role-based fallback (normalized)
    if (
      user.role &&
      ROLE_ALLOW_FOR_PERMISSION.includes(
        (user.role || "").toString().toUpperCase()
      )
    ) {
      console.info(
        "[auth] requirePermission: granting permission by role fallback",
        { role: user.role, permission }
      );
      return next();
    }

    // 3) deny
    console.warn("[auth] requirePermission denied", {
      permission,
      permissions: user.permissions,
      role: user.role,
    });
    return res.status(403).json({ message: "Truy cập bị từ chối" });
  };
};

// compatibility alias
export const authenticateToken = verifyToken;

export default {
  requireAuth,
  requireRole,
  verifyToken,
  authenticateToken,
  requirePermission,
};
