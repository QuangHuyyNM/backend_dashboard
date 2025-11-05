// ensure this file is included by tsconfig.json ("include": ["src/**/*.ts", "src/types/**/*.d.ts"]) if placed under src/types

declare global {
  namespace Express {
    // đồng nhất với AuthPayload từ src/middlewares/auth.ts
    interface Request {
      user?: import("../middlewares/auth").AuthPayload;
    }
  }
}

export {};