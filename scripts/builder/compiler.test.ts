import {describe, expect, it} from "vitest";
import {compile} from "./compiler";
import {counterSource} from "../../src/os/projects";
const request = (text: string) => ({requestId: "test", sourceRevision: "one", entry: "src/index.tsx", sdkVersion: "3" as const, files: [{path: "src/index.tsx", text}]});
describe("fixed app compiler", () => {
  it("typechecks and compiles Counter against the shared universal runtime", async () => {
    const result = await compile(request(counterSource("counter_test", "Counter")));
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("@mockintosh/ui/renderer");
    expect(result.code).toContain('from "@mockintosh/sdk"');
    expect(result.map).toContain("index.tsx");
  });
  it("reports type errors and rejects host dependencies", async () => {
    expect((await compile(request('const count: number = "wrong"; export default count;'))).diagnostics[0]).toMatchObject({file: "src/index.tsx", line: 1});
    expect((await compile(request('import fs from "node:fs"; export default fs;'))).diagnostics[0].message).toContain("Unsupported import");
    expect((await compile(request('export default function App() { alert("saved"); return null; }'))).diagnostics[0].message).toMatch(/Host API 'alert'/);
  });
});
