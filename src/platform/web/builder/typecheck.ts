import ts from "typescript";
import {compilerOptions} from "../../../shared/buildPolicy";
import type {BuildRequest, BuildResult} from "../../../shared/buildContract";
import {APP_ENV_DTS} from "../../../shared/appEnv";

// These are the shipped SDK sources and declarations, not a second hand-written
// approximation of its types. Vite embeds them only in the lazy compiler worker.
const declarations = import.meta.glob<string>([
  "/node_modules/typescript/lib/lib.*.d.ts",
  "/node_modules/solid-js/**/*.d.ts",
  "/packages/*/src/**/*.ts", "/packages/*/src/**/*.tsx",
  "!/packages/**/*.test.ts",
], {query: "?raw", import: "default", eager: true, exhaustive: true});
const options: ts.CompilerOptions = {...compilerOptions, baseUrl: "/", paths: {
  "@mockintosh/*": ["packages/*/src/index.ts"],
  "@mockintosh/ui/renderer": ["packages/ui/src/renderer.ts"],
  "@mockintosh/terminal/*": ["packages/terminal/src/*/index.ts"],
  "solid-js": ["node_modules/solid-js/types/index.d.ts"],
  "solid-js/jsx-runtime": ["node_modules/solid-js/types/jsx.d.ts"],
  "solid-js/*": ["node_modules/solid-js/*/types/index.d.ts"],
}};
export function typecheck(request: BuildRequest): BuildResult["diagnostics"] {
  const files = new Map(Object.entries(declarations));
  files.set("/project/src/app-env.d.ts", APP_ENV_DTS);
  for (const file of request.files) files.set(`/project/${file.path}`, file.text);
  const host: ts.CompilerHost = {
    getSourceFile(path, version) { const text = files.get(path); return text === undefined ? undefined : ts.createSourceFile(path, text, version, true); },
    getDefaultLibFileName: () => "/node_modules/typescript/lib/lib.es2022.d.ts",
    writeFile() {}, getCurrentDirectory: () => "/", getDirectories: () => [],
    fileExists: path => files.has(path), readFile: path => files.get(path),
    getCanonicalFileName: path => path, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
  };
  const program = ts.createProgram([...request.files.map(file => `/project/${file.path}`), "/project/src/app-env.d.ts"], options, host);
  return ts.getPreEmitDiagnostics(program).filter(d => !d.file || d.file.fileName.startsWith("/project/")).map(d => {
    const location = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
    return {message: ts.flattenDiagnosticMessageText(d.messageText, "\n"), ...(d.file ? {file: d.file.fileName.slice(9)} : {}), ...(location ? {line: location.line + 1, column: location.character + 1} : {})};
  });
}
