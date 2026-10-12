export type FSErrorCode =
  | "conflict"
  | "not-found"
  | "exists"
  | "invalid-name"
  | "invalid-move"
  | "not-a-directory"
  | "not-a-file"
  | "immutable"
  /** The node is on a locked disk. */
  | "locked";

export class FSError extends Error {
  readonly code: FSErrorCode;
  constructor(code: FSErrorCode, message: string) {
    super(message);
    this.name = "FSError";
    this.code = code;
  }
}

export function isFSError(err: unknown, code?: FSErrorCode): err is FSError {
  return err instanceof FSError && (code === undefined || err.code === code);
}
