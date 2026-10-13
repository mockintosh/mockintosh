import { decodeSuitcase, installSuitcase } from "@mockintosh/ui";
import { mountCanvasUI } from "@mockintosh/ui/web";
// Geist sets the page titles; it lives in the font library, not the built-in fonts.
import geist from "../../../public/fonts/library/geist.suit?raw";
import { App } from "./App";
import { bindCursorHost, readCursorMode } from "./cursorHost";
import { bindDevTools } from "./devtools/bind";
import { bindPaletteHost, readHostPalette } from "./hostPalette";
import { bindThemeHost, readRadiusScale } from "./hostTheme";

installSuitcase(decodeSuitcase(geist));

const host = mountCanvasUI({
  root: document.getElementById("root")!,
  size: { mode: "viewport", scale: 2 },
  cursors: readCursorMode(),
  palette: readHostPalette(),
  theme: { radius: readRadiusScale() },
  component: () => App(),
});

bindCursorHost((mode) => host.setCursors(mode));
bindPaletteHost((palette) => host.setPalette(palette));
bindThemeHost((radius) => host.setTheme({ radius }));
bindDevTools(host);
