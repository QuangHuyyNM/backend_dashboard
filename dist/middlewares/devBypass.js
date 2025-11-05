"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devBypass = void 0;
const devBypass = (req, res, next) => {
    if (process.env.SKIP_AUTH === "true") {
        // giả lập user cho tất cả request
        req.user = { id: "RTE000", role: "CEO", email: "admin@local" };
        console.log("[devBypass] Request bypassed:", req.url);
        return next();
    }
    next();
};
exports.devBypass = devBypass;
