
export const TOOL_IDS = ["select", "text", "rect", "roundrect", "oval", "line"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const TOOL_LABEL: Record<ToolId, string> = {
  select: "Selection",
  text: "Text",
  rect: "Rectangle",
  roundrect: "Rounded rectangle",
  oval: "Oval",
  line: "Line",
};

export const TOOL_GRID: readonly ToolId[][] = [
  ["select", "text"],
  ["rect", "roundrect"],
  ["oval", "line"],
];

export const SHAPE_TOOLS = new Set<ToolId>(["rect", "roundrect", "oval", "line"]);

export const FILL_LABEL: Record<"none" | "white" | "black" | "gray25" | "gray50" | "gray75", string> = {
  none: "None",
  white: "White",
  black: "Black",
  gray25: "25% Gray",
  gray50: "50% Gray",
  gray75: "75% Gray",
};
