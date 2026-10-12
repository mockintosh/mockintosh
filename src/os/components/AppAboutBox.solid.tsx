/**
 * The About box the Apple menu opens for the frontmost application. An app
 * may supply its own content (`SolidApp.about.Component`); otherwise the OS
 * draws this standard box from what the app declared — its icon and title,
 * plus `about.version` and `about.description` when given.
 */
import { Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { useOS, type OSServices } from "../context";
import { getApp, type SolidApp } from "../apps";
import { openSystemWindow } from "../systemWindows";
import type { WindowComponent } from "../state";

const ICON_SIZE = 32;
export const ABOUT_SIZE = { width: 343, height: 120 };

export interface AppAboutBoxProps extends Record<string, unknown> {
  appId: string;
}

/** Standard OS-drawn About box: icon, title, version, description. */
export function AppAboutBox(props: AppAboutBoxProps): JSX.Element {
  const os = useOS();
  const app = () => getApp(props.appId);
  const icon = () => (app() ? os.sprites.get(app()!.icon) : undefined);
  const version = () => app()?.about?.version;
  const description = () => app()?.about?.description;

  return (
    <box width="100%" height="100%" padding={16} flexDirection="row" gap={16} alignItems="flex-start" background={0}>
      <Show when={icon()}>
        {(s) => (
          <image
            width={ICON_SIZE}
            height={ICON_SIZE}
            src={{ width: s().width, height: s().height, data: s().data, mask: s().mask }}
          />
        )}
      </Show>
      <box flexDirection="column" gap={4} flexGrow={1} flexShrink={1} minWidth={0}>
        <text font="body" nowrap>{app()?.title ?? props.appId}</text>
        <Show when={version()}>
          {(v) => <text font="body" nowrap>{`Version ${v()}`}</text>}
        </Show>
        <Show when={description()}>
          {(d) => <text font="body" wrap>{d()}</text>}
        </Show>
      </box>
    </box>
  );
}

/**
 * Open "About <app>…" for `app`: its own `about.Component` when it declares
 * one, the standard `AppAboutBox` otherwise. Single-instance per app.
 */
export function openAppAboutBox(os: OSServices, app: SolidApp): string {
  const custom = app.about?.Component;
  const props: AppAboutBoxProps = { appId: app.id };
  return openSystemWindow(os, app.id, {
    title: `About ${app.title}`,
    kind: "dialog",
    size: app.about?.size ?? ABOUT_SIZE,
    Component: (custom ?? AppAboutBox) as WindowComponent,
    props,
  });
}
