import {
  For,
  Show,
  createMemo,
  createSignal,
  formatDebugJsx,
  useRadius,
  type DebugNode,
  type JSX,
} from "@mockintosh/ui";
import {
  DEVTOOLS_ROLE,
  captureTree,
  closeDevTools,
  contextMenu,
  dismissMenu,
  findInTree,
  hoverId,
  openInspect,
  panelHeight,
  panelOpen,
  picking,
  selectNode,
  selectedId,
  setPanelHeight,
  setPickMode,
  tree,
} from "./state";

const HIDDEN_OWNERS = new Set([
  "OverlayHost",
  "OverlayLayerView",
  "FocusContext",
  "ThemeContext",
  "UIServicesContext",
  "MeasureContext",
  "ViewportContext",
  "RouterProvider",
]);

function isUsefulOwner(name: string): boolean {
  if (!name || HIDDEN_OWNERS.has(name)) return false;
  if (/refresh|hmr/i.test(name)) return false;
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function visibleOwners(node: DebugNode): string[] {
  return node.owner.filter(isUsefulOwner);
}

function rowLabel(node: DebugNode): string {
  const tag = node.type === "_root" ? "#root" : node.name ? `${node.type}#${node.name}` : node.type;
  const comp = visibleOwners(node)[0];
  return comp ? `${tag} ${comp}` : tag;
}

interface TreeRow {
  id: number;
  depth: number;
  hasKids: boolean;
  label: string;
}

function flatten(node: DebugNode, depth: number, collapsed: Set<number>, out: TreeRow[]): void {
  if (node.type === "_text_content") return;
  const kids = node.children.filter((child) => child.type !== "_text_content");
  if (node.type !== "_root") {
    out.push({
      id: node.id,
      depth,
      hasKids: kids.length > 0,
      label: rowLabel(node),
    });
  }
  const nextDepth = node.type === "_root" ? depth : depth + 1;
  if (node.type === "_root" || !collapsed.has(node.id)) {
    for (const child of kids) flatten(child, nextDepth, collapsed, out);
  }
}

function ChromeButton(props: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <box
      paddingLeft={6}
      paddingRight={6}
      paddingTop={2}
      paddingBottom={2}
      background={props.pressed ? 1 : 0}
      tabIndex={0}
      cursor="pointer"
      onClick={props.onClick}
      onKeyDown={(key: string) => {
        if (key === "Enter" || key === " ") props.onClick();
      }}
    >
      <text font="genova" size={10} color={props.pressed ? 0 : 1} nowrap>
        {props.label}
      </text>
    </box>
  );
}

function InspectMenu(): JSX.Element {
  const radius = useRadius("md");
  const menu = contextMenu;
  return (
    <Show when={menu()}>
      <box
        semantic={{ name: "devtools-menu-catcher", role: DEVTOOLS_ROLE }}
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        onMouseDown={() => dismissMenu()}
      >
        <box
          semantic={{ name: "devtools-menu", role: DEVTOOLS_ROLE }}
          position="absolute"
          left={menu()!.x}
          top={menu()!.y}
          minWidth={100}
          flexDirection="column"
          borderColor={1}
          borderWidth={1}
          borderRadius={radius()}
          background={0}
        >
          <box
            semantic={{ name: "devtools-menu:inspect", role: "menuitem" }}
            paddingLeft={6}
            paddingRight={8}
            paddingTop={2}
            paddingBottom={2}
            cursor="pointer"
            onClick={() => openInspect(menu()!.id)}
          >
            <text font="body" nowrap>
              Inspect
            </text>
          </box>
        </box>
      </box>
    </Show>
  );
}

function InspectHighlight(): JSX.Element {
  const node = createMemo(() => findInTree(hoverId() ?? selectedId()));
  return (
    <Show when={panelOpen() && node() && node()!.type !== "_root"}>
      <box
        semantic={{ name: "devtools-highlight", role: DEVTOOLS_ROLE }}
        inert
        position="absolute"
        left={node()!.bounds.x}
        top={node()!.bounds.y}
        width={node()!.bounds.width}
        height={node()!.bounds.height}
        borderColor={1}
        borderWidth={1}
        borderStyle="dotted"
      />
    </Show>
  );
}

function DevToolsPanel(): JSX.Element {
  const [collapsed, setCollapsed] = createSignal(new Set<number>());
  const rows = createMemo(() => {
    const root = tree();
    const out: TreeRow[] = [];
    if (root) flatten(root, 0, collapsed(), out);
    return out;
  });
  const selected = createMemo(() => findInTree(selectedId()));
  const jsxLines = createMemo(() => {
    const node = selected();
    if (!node) return ["Select a node, or right-click Inspect."];
    return formatDebugJsx(node, { maxDepth: 5 }).split("\n");
  });
  const owners = createMemo(() => {
    const node = selected();
    return node ? visibleOwners(node) : [];
  });
  const bodyH = () => Math.max(40, panelHeight() - 22);

  return (
    <box
      semantic={{ name: "devtools-panel", role: DEVTOOLS_ROLE }}
      width="100%"
      height={panelHeight()}
      minHeight={72}
      flexShrink={0}
      flexDirection="column"
      background={0}
      borderColor={1}
      borderWidth={1}
    >
      <box
        semantic={{ name: "devtools-resize", role: DEVTOOLS_ROLE }}
        height={3}
        width="100%"
        background="hstripe"
        cursor="ns-resize"
        onDrag={(_lx, _ly, _gx, gy) => {
          const host = tree();
          const max = host ? Math.max(72, host.bounds.height - 36) : 220;
          setPanelHeight(Math.max(72, Math.min(max, host ? host.bounds.height - gy : 128)));
        }}
      />
      <box
        flexDirection="row"
        alignItems="center"
        paddingLeft={4}
        paddingRight={4}
        height={18}
        gap={6}
      >
        <ChromeButton
          label="Pick"
          pressed={picking()}
          onClick={() => setPickMode(!picking())}
        />
        <text font="genova" size={10} nowrap>
          DevTools
        </text>
        <Show when={selected()}>
          <text font="genova" size={10} nowrap>
            {visibleOwners(selected()!)[0] ?? (selected()!.type === "_root" ? "" : selected()!.type)}
          </text>
        </Show>
        <box flexGrow={1} />
        <ChromeButton label="Close" onClick={() => closeDevTools()} />
      </box>
      <box height={1} width="100%" background={1} />
      <box flexDirection="row" width="100%" height={bodyH()} minHeight={0}>
        <box width="42%" minWidth={120} height="100%" overflow="scroll" padding={4} gap={1}>
          <For each={rows()}>
            {(row) => {
              const active = () => selectedId() === row.id;
              return (
                <box
                  semantic={{ name: `devtools-row:${row.id}`, role: DEVTOOLS_ROLE }}
                  flexDirection="row"
                  paddingLeft={4 + row.depth * 8}
                  paddingRight={4}
                  paddingTop={1}
                  paddingBottom={1}
                  background={active() ? 1 : 0}
                  cursor="pointer"
                  onClick={() => {
                    if (row.hasKids) {
                      const next = new Set(collapsed());
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      setCollapsed(next);
                    }
                    selectNode(row.id);
                    captureTree();
                  }}
                >
                  <text font="body" color={active() ? 0 : 1} nowrap>
                    {`${row.hasKids ? (collapsed().has(row.id) ? "+ " : "- ") : "  "}${row.label}`}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
        <box width={1} height="100%" background="vstripe" />
        <box flexGrow={1} minWidth={0} height="100%" overflow="scroll" padding={6} gap={4}>
          <Show when={owners().length > 0}>
            <text font="genova" size={10} wrap>
              {owners().map((name) => `<${name}>`).join(" ← ")}
            </text>
          </Show>
          <For each={jsxLines()}>
            {(line) => (
              <text font="mono" size={9} selectable nowrap>
                {line.length === 0 ? " " : line}
              </text>
            )}
          </For>
        </box>
      </box>
    </box>
  );
}

/** Docked 1-bit inspector plus the floating Inspect menu and highlight. */
export function DevToolsChrome(): JSX.Element {
  return (
    <>
      <Show when={panelOpen()}>
        <DevToolsPanel />
      </Show>
      <InspectHighlight />
      <InspectMenu />
    </>
  );
}
