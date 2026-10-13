import { Dialog, For, Show, createSignal, createEffect, onCleanup, useMeasure, useRadius, useViewport } from "@mockintosh/ui";
import type { JSX } from "@mockintosh/ui";
import { HEADER_LINKS, SIDEBAR, headerActive } from "./nav";
import { useRouter } from "./router";
import { SettingsMenu } from "./settings";

/** Sidebar (112) plus a readable article column no longer fits. */
const COMPACT_MAX = 320;

const NAV_PAD_X = 6;
const NAV_GAP = 4;
const HEADER_PAD_X = 16;
const HEADER_GAP = 20;
const UNDERLINE_MS = 180;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function useCompact(): () => boolean {
  const vp = useViewport();
  return () => vp().width < COMPACT_MAX;
}

export function NavLink(props: {
  href: string;
  label: string;
  active: boolean;
  font?: string;
  size?: number;
  /** Invert the label when active. Header uses an underline instead. */
  invert?: boolean;
}): JSX.Element {
  const router = useRouter();
  const invert = () => props.invert !== false && props.active;
  return (
    <box
      alignSelf="flex-start"
      paddingLeft={NAV_PAD_X}
      paddingRight={NAV_PAD_X}
      paddingTop={3}
      paddingBottom={3}
      background={invert() ? 1 : 0}
      tabIndex={0}
      cursor="pointer"
      onClick={() => router.navigate(props.href)}
      onKeyDown={(key: string) => {
        if (key === "Enter" || key === " ") router.navigate(props.href);
      }}
    >
      <text font={props.font ?? "body"} size={props.size} color={invert() ? 0 : 1} nowrap>
        {props.label}
      </text>
    </box>
  );
}

function headerUnderline(path: string, measure: (text: string) => number): { x: number; width: number } {
  let x = 0;
  for (const link of HEADER_LINKS) {
    const width = measure(link.title) + NAV_PAD_X * 2;
    if (headerActive(path, link.href)) return { x, width };
    x += width + NAV_GAP;
  }
  return { x: 0, width: 0 };
}

function Brand(): JSX.Element {
  const router = useRouter();
  return (
    <box
      tabIndex={0}
      cursor="pointer"
      flexDirection="row"
      alignItems="center"
      onClick={() => router.navigate("/")}
      onKeyDown={(key: string) => {
        if (key === "Enter" || key === " ") router.navigate("/");
      }}
    >
      <text font="geneva" size={10} nowrap>
        mockintosh/
      </text>
      <text font="geneva" size={10} bold nowrap>
        ui
      </text>
    </box>
  );
}

function HeaderNav(): JSX.Element {
  const router = useRouter();
  return (
    <box flexDirection="row" alignItems="center" gap={NAV_GAP}>
      <For each={HEADER_LINKS}>
        {(link) => (
          <NavLink
            href={link.href}
            label={link.title}
            active={headerActive(router.path(), link.href)}
            invert={false}
            font="geneva"
            size={10}
          />
        )}
      </For>
      <SettingsMenu />
    </box>
  );
}

function CompactMenu(): JSX.Element {
  const router = useRouter();
  const vp = useViewport();
  const [open, setOpen] = createSignal(false);
  createEffect(
    () => router.path(),
    () => {
      setOpen(false);
    },
  );
  const menuWidth = () => Math.min(220, Math.max(160, vp().width - 24));
  const menuHeight = () => Math.min(260, Math.max(80, vp().height - 80));
  return (
    <Dialog
      name="nav"
      open={open()}
      onDismiss={() => setOpen(false)}
      title="Menu"
      width={menuWidth()}
      trigger={
        <box
          paddingLeft={6}
          paddingRight={6}
          paddingTop={3}
          paddingBottom={3}
          background={open() ? 1 : 0}
          tabIndex={0}
          cursor="pointer"
          onClick={() => setOpen(true)}
          onKeyDown={(key: string) => {
            if (key === "Enter" || key === " ") setOpen((on) => !on);
          }}
        >
          <text font="geneva" size={10} color={open() ? 0 : 1} nowrap>
            Menu
          </text>
        </box>
      }
    >
      <box width="100%" height={menuHeight()} overflow="scroll" gap={12}>
        <box flexDirection="column" gap={2}>
          <For each={HEADER_LINKS}>
            {(link) => (
              <NavLink
                href={link.href}
                label={link.title}
                active={headerActive(router.path(), link.href)}
              />
            )}
          </For>
        </box>
        <For each={SIDEBAR}>
          {(section) => (
            <box flexDirection="column" gap={4}>
              <text font="geneva" size={10} nowrap>
                {section.title}
              </text>
              <For each={section.items}>
                {(item) => (
                  <NavLink
                    href={item.href}
                    label={item.title}
                    active={router.path() === item.href}
                  />
                )}
              </For>
            </box>
          )}
        </For>
      </box>
    </Dialog>
  );
}

export function SiteHeader(): JSX.Element {
  const compact = useCompact();
  return (
    <Show when={compact()} fallback={<RegularHeader />}>
      <CompactHeader />
    </Show>
  );
}

function CompactHeader(): JSX.Element {
  return (
    <box width="100%" flexDirection="column" background={0}>
      <box
        width="100%"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingLeft={12}
        paddingRight={8}
        paddingTop={6}
        paddingBottom={5}
        gap={8}
      >
        <Brand />
        <box flexDirection="row" alignItems="center" gap={4}>
          <SettingsMenu />
          <CompactMenu />
        </box>
      </box>
      <box height={1} width="100%" background="vstripe" />
    </box>
  );
}

function RegularHeader(): JSX.Element {
  const router = useRouter();
  const { measureText } = useMeasure();
  const measure = (text: string) => measureText(text, "geneva", {}, 10);
  const navLeft =
    HEADER_PAD_X + measure("mockintosh/") + measureText("ui", "geneva", { bold: true }, 10) + HEADER_GAP;
  const [barX, setBarX] = createSignal(0);
  const [barW, setBarW] = createSignal(0);
  let frame = 0;
  onCleanup(() => cancelAnimationFrame(frame));

  createEffect(
    () => router.path(),
    (path) => {
      const to = headerUnderline(path, measure);
      const fromX = barX();
      const fromW = barW();
      cancelAnimationFrame(frame);
      if (fromW === 0) {
        setBarX(to.x);
        setBarW(to.width);
        return;
      }
      const started = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / UNDERLINE_MS);
        const e = easeOutCubic(t);
        setBarX(Math.round(fromX + (to.x - fromX) * e));
        setBarW(Math.round(fromW + (to.width - fromW) * e));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    },
  );

  return (
    <box width="100%" flexDirection="column" background={0}>
      <box
        flexDirection="row"
        alignItems="center"
        paddingLeft={HEADER_PAD_X}
        paddingRight={HEADER_PAD_X}
        paddingTop={6}
        paddingBottom={5}
        gap={HEADER_GAP}
      >
        <Brand />
        <HeaderNav />
      </box>
      <box height={1} width="100%" background="vstripe">
        <box
          position="absolute"
          left={navLeft + barX()}
          top={0}
          width={barW()}
          height={1}
          background={1}
        />
      </box>
    </box>
  );
}

export function Sidebar(): JSX.Element {
  const router = useRouter();
  return (
    <box
      width={112}
      minWidth={112}
      flexShrink={0}
      height="100%"
      overflow="scroll"
      padding={8}
      gap={16}
      background={0}
    >
      <For each={SIDEBAR}>
        {(section) => (
          <box flexDirection="column" gap={4}>
            <text font="geneva" size={10} nowrap>
              {section.title}
            </text>
            <For each={section.items}>
              {(item) => (
                <NavLink
                  href={item.href}
                  label={item.title}
                  active={router.path() === item.href}
                />
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}

const DOCS_CONTENT_MAX = 320;

export function DocsLayout(props: { children?: JSX.Element }): JSX.Element {
  const router = useRouter();
  const compact = useCompact();
  const pad = () => (compact() ? 12 : 24);
  return (
    <box flexGrow={1} flexDirection="row" width="100%" height="100%">
      <Show when={!compact()}>
        <Sidebar />
        <box width={1} height="100%" background="hstripe" />
      </Show>
      <box
        flexGrow={1}
        height="100%"
        overflow="scroll"
        scrollKey={router.path()}
        padding={pad()}
        paddingTop={compact() ? 16 : 28}
        background={0}
      >
        <box
          width="100%"
          maxWidth={DOCS_CONTENT_MAX}
          alignSelf="center"
          flexDirection="column"
          gap={16}
        >
          {props.children}
        </box>
      </box>
    </box>
  );
}

function CodeBlock(props: { code: string }): JSX.Element {
  const lines = props.code.replace(/^\n/, "").replace(/\n$/, "").split("\n");
  return (
    <box padding={12} gap={1} background={0}>
      <For each={lines}>
        {(line) => (
          <text font="mono" selectable nowrap>
            {line.length === 0 ? " " : line}
          </text>
        )}
      </For>
    </box>
  );
}

/** Live widget plus the JSX that built it. */
export function Preview(props: { code: string; children?: JSX.Element }): JSX.Element {
  const radius = useRadius("lg");
  return (
    <box borderColor={1} borderWidth={1} borderRadius={radius()} background={0}>
      <box padding={16} gap={12}>
        {props.children}
      </box>
      <box height={1} background={1} />
      <CodeBlock code={props.code} />
    </box>
  );
}

export function PageTitle(props: { title: string; lede?: string }): JSX.Element {
  return (
    <box flexDirection="column" gap={8}>
      <text font="geist" wrap>{props.title}</text>
      <Show when={props.lede}>
        <text font="body" wrap selectable>
          {props.lede!}
        </text>
      </Show>
    </box>
  );
}
