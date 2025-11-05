// src/utils/errorHelpers.ts
export function toErrorMessage(err: unknown): string {
  if (!err) return String(err);
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    // @ts-ignore
    if (typeof (err as any).message === "string") return (err as any).message;
  } catch {}
  return String(err);
}
