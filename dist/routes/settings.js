"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/settings.ts (QUICK FIX - KHÔNG CẦN SQL)
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const router = express_1.default.Router();
const SETTINGS_FILE = path_1.default.join(__dirname, '../../settings.json');
// Helper: read/write JSON file
function readSettings() {
    try {
        if (fs_1.default.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs_1.default.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    }
    catch (e) { }
    // Default
    return {
        siteName: "RTE Academy",
        timezone: "Asia/Ho_Chi_Minh",
        enableEmailNotifications: true,
        attendanceRequirePhoto: false,
        theme: "system"
    };
}
function writeSettings(data) {
    fs_1.default.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}
// GET /api/settings
router.get("/", (req, res) => {
    try {
        const settings = readSettings();
        res.json(settings);
    }
    catch (err) {
        console.error("[settings] GET error:", err);
        res.status(500).json({ message: "Server error" });
    }
});
// POST /api/settings
router.post("/", (req, res) => {
    try {
        const { siteName, timezone, enableEmailNotifications, attendanceRequirePhoto, theme } = req.body;
        if (theme && !['light', 'dark', 'system'].includes(theme)) {
            return res.status(400).json({ message: "Invalid theme" });
        }
        const settings = {
            siteName: siteName || "RTE Academy",
            timezone: timezone || "Asia/Ho_Chi_Minh",
            enableEmailNotifications: Boolean(enableEmailNotifications),
            attendanceRequirePhoto: Boolean(attendanceRequirePhoto),
            theme: theme || 'system'
        };
        writeSettings(settings);
        console.log("[settings] Saved:", settings);
        res.json({ message: "Lưu thành công", data: settings });
    }
    catch (err) {
        console.error("[settings] POST error:", err);
        res.status(500).json({ message: "Server error" });
    }
});
exports.default = router;
