import { HTTP_TOOLS, type OpenAITool, type OpenAIToolParameter } from "@mockintosh/protocol";

export const AGENT_TRAPS = [
  "project_create",
  "read",
  "read_lines",
  "write",
  "edit",
  "stat",
  "list",
  "search",
  "build_submit",
  "build_status",
  "build_cancel",
  "project_check",
  "app_install",
  "app_restart",
  "open",
  "inspect",
  "click",
  "dblclick",
  "drag",
  "pointer",
  "type",
  "windows",
  "apps",
  "screenshot",
  "logs",
] as const;

export const AGENT_TRAP_SET = new Set<string>(AGENT_TRAPS);
export const HTTP_TOOL_NAMES = new Set(HTTP_TOOLS.map((tool) => tool.function.name));

export const READ_ONLY_TOOLS = new Set<string>([
  "read", "read_lines", "stat", "list", "search", "inspect", "windows", "apps",
  "screenshot", "logs", "project_check", "build_status",
]);

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  project_create: "Create a project. Use template \"canvas\" for drawing apps, \"blank\" for an empty window, \"counter\" for a button+label. Always pick a unique id.",
  read: "Read a whole UTF-8 file. Prefer read_lines for large files. After reading you may edit.",
  read_lines: "Read a 1-based line range. Returns text plus revision — required before edit.",
  write: "Write a whole file. Use only for the first version; prefer edit after that. Read first if the file already exists.",
  edit: "Exact-string replacement (oldText must match once unless replaceAll). Requires expectedRevision from the last read.",
  stat: "Inspect path, kind, and revision.",
  list: "List a directory. Set recursive=true to walk a subtree.",
  search: "Regex search under /disk or /system/source. Use this before guessing SDK APIs.",
  build_submit: "Compile the project. The tool waits until the job finishes and returns diagnostics.",
  project_check: "Typecheck without bundling. Called automatically after write/edit.",
  app_install: "Install a successful build and open the app. Pass the full id string returned by build_submit, unchanged, or omit build to install the newest.",
  inspect: "Semantic UI tree (name, bounds, text). Use names you set with semantic={{name}} or Button name=.",
  click: "Click a named control.",
  drag: "Press at a named target (or x,y) and drag to x,y. Required to draw on a bitmap.",
  screenshot: "Capture the 1-bit screen as an image you can see. Use after drag to verify paint.",
  logs: "Runtime errors from the installed app (handlers, paint). Compile diagnostics are not enough.",
  open: "Open an app by id.",
  type: "Type into the focused named field.",
  windows: "List open windows.",
  apps: "List registered apps.",
};

export interface ToolContract {
  name: string;
  description: string;
  inputSchema: unknown;
}

export function openaiToolsFromContracts(contracts: readonly ToolContract[]): OpenAITool[] {
  const byName = new Map(contracts.map((c) => [c.name, c]));
  return AGENT_TRAPS
    .filter((name) => byName.has(name))
    .map((name) => {
      const operation = byName.get(name)!;
      return {
        type: "function" as const,
        function: {
          name: operation.name,
          description: TOOL_DESCRIPTIONS[name] ?? operation.description,
          parameters: operation.inputSchema as OpenAIToolParameter,
        },
      };
    })
    .sort((a, b) => a.function.name.localeCompare(b.function.name));
}

export function allAgentTools(contracts: readonly ToolContract[]): OpenAITool[] {
  return [...openaiToolsFromContracts(contracts), ...HTTP_TOOLS]
    .sort((a, b) => a.function.name.localeCompare(b.function.name));
}

export const ACTIVITY_LABEL: Record<string, string> = {
  project_create: "Writing source",
  write: "Writing source",
  edit: "Editing source",
  read: "Reading source",
  read_lines: "Reading source",
  stat: "Reading source",
  list: "Reading source",
  search: "Searching source",
  build_submit: "Building",
  build_status: "Building",
  build_cancel: "Building",
  project_check: "Typechecking",
  app_install: "Trying the app",
  app_restart: "Trying the app",
  open: "Trying the app",
  inspect: "Trying the app",
  click: "Trying the app",
  dblclick: "Trying the app",
  drag: "Trying the app",
  pointer: "Trying the app",
  type: "Trying the app",
  windows: "Trying the app",
  apps: "Trying the app",
  screenshot: "Looking at the screen",
  logs: "Reading logs",
  generate_image: "Generating image",
};

export function activityLabel(name: string): string {
  return ACTIVITY_LABEL[name] ?? name;
}
