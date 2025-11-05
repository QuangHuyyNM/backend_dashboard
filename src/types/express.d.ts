// src/types/express.d.ts
import { JwtPayloadMinimal } from "../middleware/auth";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role?: string | null;
        email?: string | null;
      };
    }
  }
}
