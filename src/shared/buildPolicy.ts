import ts from "typescript";
import {buildRequest, projectPath, type BuildRequest} from "./buildContract";
import {parse} from "./schema";

export const sharedBuildImports = new Set(["solid-js", "@mockintosh/sdk", "@mockintosh/ui", "@mockintosh/ui/renderer", "@mockintosh/quickdraw", "@mockintosh/agent"]);
/** Browser globals that share the OS JavaScript realm. Apps must use the SDK. */
export const bannedHostGlobals = new Set([
  "alert", "confirm", "prompt",
  "document", "localStorage", "sessionStorage",
  "indexedDB", "XMLHttpRequest",
]);
export const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve, jsxImportSource: "@mockintosh/ui", strict: true, noEmit: true, skipLibCheck: true,
  allowJs: true, checkJs: true, types: [], lib: ["lib.es2022.d.ts"],
};
/** `foo.alert` / `{ alert }` bindings / `alert() {}` members are not the host global. */
function isHostGlobalUse(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if ((ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)) && parent.name === node) return false;
  if ((ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  return true;
}
/** Resolve relative imports inside the submitted project, independently of host paths. */
export function relativeImport(importer: string, specifier: string): string {
  const parts = importer.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || !part) continue;
    if (part === "..") { if (!parts.length) throw new Error(`Unsupported import: ${specifier}`); parts.pop(); }
    else parts.push(part);
  }
  const result = parts.join("/");
  if (!projectPath(result)) throw new Error(`Unsupported import: ${specifier}`);
  return result;
}
export function validateSources(request: BuildRequest): void {
  parse(buildRequest, request);
  if (!projectPath(request.entry) || request.files.length > 128 || request.files.reduce((n, f) => n + new TextEncoder().encode(f.text).length, 0) > 1048576)
    throw new Error("Invalid or oversized project");
  const seen = new Set<string>();
  for (const file of request.files) {
    if (!projectPath(file.path) || !/\.(tsx?|jsx?)$/.test(file.path) || seen.has(file.path)) throw new Error("Only unique relative JS/TS source files are supported");
    seen.add(file.path);
    const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);
    function inspect(node: ts.Node) {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        if (node.expression.kind !== ts.SyntaxKind.ImportKeyword || node.arguments.length !== 1) throw new Error("Use static ESM imports");
        specifier = node.arguments[0];
      }
      if (specifier) {
        if (!ts.isStringLiteral(specifier)) throw new Error("Dynamic import expressions are unsupported");
        const id = specifier.text;
        if (!sharedBuildImports.has(id)) {
          if (!id.startsWith(".")) throw new Error(`Unsupported import: ${id}`);
          relativeImport(file.path, id);
        }
      }
      if (ts.isIdentifier(node) && bannedHostGlobals.has(node.text) && isHostGlobalUse(node)) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        throw new Error(`${file.path}:${line + 1}:${character + 1}: Host API '${node.text}' is not available. Use the SDK (useApp().os.showDialog, useApp().storage, useApp().fetch).`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  if (!seen.has(request.entry)) throw new Error("Entry source is missing");
}
