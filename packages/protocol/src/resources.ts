import * as s from "./schema";
import { diagnostic } from "./buildContract";

export const resource = s.object({
  id: s.string, revision: s.integer, path: s.string,
  kind: { type: "string", enum: ["file", "directory"] }, contentType: s.string,
  /** Bytes in a file's body. */
  size: s.integer,
  /** Last change, epoch milliseconds. */
  modified: s.integer,
}, ["id", "revision", "path", "kind", "contentType"]);
export type Resource = s.Value<typeof resource>;

export const jobSchema = s.object({
  id: s.string, project: s.string, sourceRevision: s.string,
  state: { enum: ["building", "succeeded", "failed", "cancelled"] },
  diagnostics: s.array(diagnostic),
});
export type Job = s.Value<typeof jobSchema>;
export type Diagnostic = s.Value<typeof diagnostic>;
