import { Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { OSContext } from "./context";
import type { OSServices } from "./context";
import {
  getMenubarMenus,
  getSplashVisible,
  setSplashVisible,
  getWindowOutline,
  getScreenshotMarquee,
} from "./state";
import { Splash } from "./components/Splash.solid";
import { Desktop } from "./components/Desktop.solid";
import { WindowStack } from "./components/WindowStack.solid";
import { Menubar } from "./components/Menubar.solid";
import { menubarTop } from "./menubarReveal";
import { ScreenCorners } from "./components/ScreenCorners.solid";
import { FinderDragGhost } from "../../apps/Finder.solid";

interface OSRootProps {
  services: OSServices;
  menubarHeight: number;
}

export function OSRoot(props: OSRootProps): JSX.Element {
  return (
    <OSContext value={props.services}>
      <box width={props.services.resolution.width} height={props.services.resolution.height}>
        <Show when={getSplashVisible()}>
          <Splash onDismiss={() => setSplashVisible(false)} />
        </Show>
        <Show when={!getSplashVisible()}>
          <Desktop />
          <WindowStack />
          {/* Drag ghost renders above windows but below menubar */}
          <FinderDragGhost />
          <Show when={getWindowOutline()}>
            {(r) => (
              <box
                position="absolute"
                left={r().x}
                top={r().y}
                width={r().width}
                height={r().height}
                borderColor={1}
                borderWidth={1}
                borderStyle="dotted"
                penMode="xor"
              />
            )}
          </Show>
          {/* Tucked above a full-screen window until the top edge brings it down. */}
          <Menubar height={props.menubarHeight} top={menubarTop()} menus={getMenubarMenus()} />
          <Show when={getScreenshotMarquee()}>
            {(r) => (
              <box
                position="absolute"
                left={r().x}
                top={r().y}
                width={r().width}
                height={r().height}
                borderColor={1}
                borderWidth={1}
                borderStyle="dotted"
                penMode="xor"
              />
            )}
          </Show>
        </Show>
        <ScreenCorners />
      </box>
    </OSContext>
  );
}

/** Factory function for mounting; avoids needing JSX in the entry point. */
export function makeOSRoot(services: OSServices, menubarHeight: number): () => JSX.Element {
  return () => <OSRoot services={services} menubarHeight={menubarHeight} />;
}
