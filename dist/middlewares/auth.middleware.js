"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = exports.requirePermission = exports.verifyToken = exports.requireRole = exports.requireAuth = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const SECRET = process.env.JWT_SECRET ||
    process.env.DEV_JWT_SECRET ||
    "dev-secret-CHANGE_ME";
/**
 * ROLE_ALLOW_FOR_PERMISSION env variable can be a comma separated list.
 * We'll normalize by trimming and uppercasing.
 */
const ROLE_ALLOW_FOR_PERMISSION = (process.env.ROLE_ALLOW_FOR_PERMISSION || "ADMISSIONS,ADMIN,CEO,DEVELOPER")
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
/**
 * Try to parse dev user from header or env:
 * - Accept JSON stringified object
 * - Or a short form "ID:ROLE:Name"
 */
function tryParseDevUser(header) {
    if (!header) {
        return null;
    }
    try {
        // support simple "id:ROLE:Name" shorthand
        if (header.includes(":") && !header.trim().startsWith("{")) {
            const [id, role, name] = header.split(":").map((s) => s.trim());
            const u = { id: id || "dev-user", role, name };
            console.debug("[auth] parsed short dev user ->", u);
            return u;
        }
        // try parse JSON string
        const p = JSON.parse(header);
        if (p && typeof p === "object") {
            const u = {
                id: (p.id && String(p.id)) || "dev-user",
                role: p.role,
                name: p.name,
                permissions: Array.isArray(p.permissions) ? p.permissions : undefined,
            };
            console.debug("[auth] parsed json dev user ->", u);
            return u;
        }
    }
    catch (e) {
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
const requireAuth = (req, res, next) => {
    const authHeader = (req.headers.authorization ||
        req.headers["authorization"]);
    // DEV fallback using x-dev-user header or DEV_USER env
    if (!authHeader && process.env.NODE_ENV !== "production") {
        const devHeader = (req.headers["x-dev-user"] ||
            req.headers["x-dev-user".toLowerCase()]);
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
        const decoded = jsonwebtoken_1.default.verify(token, SECRET);
        if (decoded && decoded.id && typeof decoded.id !== "string")
            decoded.id = String(decoded.id);
        req.user = decoded;
        return next();
    }
    catch (err) {
        console.error("JWT verify error:", err);
        return res
            .status(401)
            .json({ message: "Invalid token", error: err?.message });
    }
};
exports.requireAuth = requireAuth;
/**
 * requireRole(roles[])
 * - roles: array of allowed roles (string matching exact role value in token)
 */
const requireRole = (roles) => {
    return (req, res, next) => {
        const user = req.user;
        if (!user)
            return res.status(401).json({ message: "Not authenticated" });
        const role = (user.role || "").toString();
        if (!roles.includes(role))
            return res.status(403).json({ message: "Truy cập bị từ chối" });
        return next();
    };
};
exports.requireRole = requireRole;
/**
 * verifyToken alias (callback-style)
 */
const verifyToken = (req, res, next) => {
    const authHeader = (req.headers["authorization"] ||
        req.headers["Authorization"]);
    if (!authHeader && process.env.NODE_ENV !== "production") {
        const devHeader = (req.headers["x-dev-user"] ||
            req.headers["x-dev-user".toLowerCase()]);
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
    jsonwebtoken_1.default.verify(token, SECRET, (err, decoded) => {
        if (err) {
            console.error("JWT verify error:", err);
            return res
                .status(401)
                .json({ message: "Token invalid", error: err.message });
        }
        const p = decoded;
        if (p && p.id && typeof p.id !== "string")
            p.id = String(p.id);
        req.user = p;
        next();
    });
};
exports.verifyToken = verifyToken;
/**
 * requirePermission(permission)
 * - If token contains explicit permissions[] array, use it.
 * - Otherwise fallback to allow if user's role exists in ROLE_ALLOW_FOR_PERMISSION.
 */
const requirePermission = (permission) => {
    return (req, res, next) => {
        const user = req.user;
        console.debug("[auth] requirePermission check", { permission, user });
        if (!user)
            return res.status(401).json({ message: "Not authenticated" });
        // 1) explicit permissions array
        if (Array.isArray(user.permissions) &&
            user.permissions.includes(permission)) {
            return next();
        }
        // 2) role-based fallback (normalized)
        if (user.role &&
            ROLE_ALLOW_FOR_PERMISSION.includes((user.role || "").toString().toUpperCase())) {
            console.info("[auth] requirePermission: granting permission by role fallback", { role: user.role, permission });
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
exports.requirePermission = requirePermission;
// compatibility alias
exports.authenticateToken = exports.verifyToken;
exports.default = {
    requireAuth: exports.requireAuth,
    requireRole: exports.requireRole,
    verifyToken: exports.verifyToken,
    authenticateToken: exports.authenticateToken,
    requirePermission: exports.requirePermission,
};
