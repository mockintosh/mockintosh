/**
 * "About This Computer…" — the Finder's About box. A Finder-owned dialog
 * window; there is no standalone About program.
 */
import type { JSX } from "@mockintosh/ui";
import { For, createSignal } from "solid-js";
import pkg from "../../package.json";
import { useApp } from "@mockintosh/sdk";
import { useOS, type IconScreenRect, type OSServices } from "../../src/os/context";
import { FINDER_APP_ID, getWindows } from "../../src/os/state";
import { openSystemWindow } from "../../src/os/systemWindows";
import { contributors } from "./contributors.generated";

export const ABOUT_BOX_TITLE = "About This Computer";
export const SOURCE_REPO_URL = "https://github.com/mockintosh/mockintosh";

export function AboutBox(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const os = useOS();
  const computer = app.getSprite("icon/computer");
  const user = app.getSprite("user2");
  const [linkRect, setLinkRect] = createSignal<IconScreenRect | undefined>(undefined);

  function openRepo(): void {
    const running = getWindows().some((w) => w.appId === "safari");
    os.openApp("safari", { url: SOURCE_REPO_URL }, running ? undefined : linkRect());
  }

  return (
    <box width="100%" height="100%" padding={8} flexDirection="column" gap={4} background={0}>
      <box flexDirection="row" gap={8} alignItems="center">
        {computer && (
          <image
            width={computer.width}
            height={computer.height}
            src={{ width: computer.width, height: computer.height, data: computer.data, mask: computer.mask }}
          />
        )}
        <box flexDirection="column" gap={2}>
          <text font="body" nowrap>Mockintosh OS</text>
          <text font="body" nowrap>{`v${pkg.version}`}</text>
          <box
            cursor="pointer"
            semantic={{ name: "about-github", role: "link" }}
            onLayout={({ x, y, width, height }) => setLinkRect({ x, y, width, height })}
            onClick={openRepo}
          >
            <text font="body" nowrap underline>
              github.com/mockintosh/mockintosh
            </text>
          </box>
        </box>
      </box>
      <text font="body" nowrap>Contributors</text>
      <box height={1} background={1} />
      <box flexGrow={1} minHeight={0} overflow="scroll">
        <For each={contributors}>
          {(c) => (
            <box flexDirection="row" alignItems="center" gap={8}>
              {user && (
                <image
                  width={user.width}
                  height={user.height}
                  src={{ width: user.width, height: user.height, data: user.data, mask: user.mask }}
                />
              )}
              <text font="body" nowrap>{`@${c.username}`}</text>
              <box flexGrow={1} />
              <text font="body" nowrap>{`${c.commits} commits`}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  );
}

/** Open the Finder's About box, or bring the open one to the front. */
export function openAboutBox(os: OSServices): string {
  return openSystemWindow(os, FINDER_APP_ID, {
    title: ABOUT_BOX_TITLE,
    kind: "dialog",
    size: { width: 343, height: 160 },
    Component: AboutBox,
  });
}
