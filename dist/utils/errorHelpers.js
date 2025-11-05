"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toErrorMessage = toErrorMessage;
// src/utils/errorHelpers.ts
function toErrorMessage(err) {
    if (!err)
        return String(err);
    if (typeof err === "string")
        return err;
    if (err instanceof Error)
        return err.message;
    try {
        // @ts-ignore
        if (typeof err.message === "string")
            return err.message;
    }
    catch { }
    return String(err);
}
