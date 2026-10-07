import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { TextInput } from "@mockintosh/ui";
import { WindowFooter, WindowHeader, defineApp, useApp, type Sprite } from "@mockintosh/sdk";
import {
  ICON_GROUP_LABEL,
  familyLabel,
  shippedIconCatalog,
} from "../src/os/iconCatalog/catalog";
import { familyFromRecord, familyMembers, familyPreview } from "../src/os/iconCatalog/decode";
import type { IconFamilyMember } from "../src/os/iconCatalog/decode";
import type { CatalogFamilyRecord, IconFamily, IconGroup } from "../src/os/iconCatalog/types";
import catalogFile from "../src/os/iconCatalog/system753.json";

type Filter = "all" | IconGroup;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "system", label: "System" },
  { id: "finder", label: "Finder" },
  { id: "cdev", label: "CDEVs" },
  { id: "app", label: "Apps" },
  { id: "stack", label: "Stacks" },
];

const CELL_W = 68;
const CELL_H = 58;
const CELL_GAP = 2;
const PAD = 6;
const FIELD_H = 16;
const LINE_H = 12;
const TOOLBAR_H = PAD * 2 + FIELD_H + LINE_H * 2 + 4 * 2;
const FOOTER_H = 72;

function imageSrc(sprite: Sprite): Sprite {
  return { width: sprite.width, height: sprite.height, data: sprite.data, mask: sprite.mask };
}

function IconGallery(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const families = shippedIconCatalog();
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<Filter>("all");
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const visible = createMemo(() => {
    const q = query().trim().toLowerCase();
    const group = filter();
    return families.filter((family) => {
      if (group !== "all" && family.group !== group) return false;
      if (!q) return true;
      const label = familyLabel(family).toLowerCase();
      return (
        label.includes(q) ||
        family.source.toLowerCase().includes(q) ||
        String(family.id).includes(q)
      );
    });
  });

  const selected = createMemo(() => {
    const key = selectedId();
    return visible().find((f) => familyKey(f) === key) ?? visible()[0];
  });

  const columns = createMemo(() => Math.max(1, Math.floor((win.width() - PAD * 2) / CELL_W)));
  const rows = createMemo(() => {
    const cols = columns();
    const list = visible();
    const out: IconFamily[][] = [];
    for (let i = 0; i < list.length; i += cols) out.push(list.slice(i, i + cols));
    return out;
  });

  const members = createMemo(() => {
    const family = selected();
    return family ? familyMembers(family) : [];
  });

  const contentHeight = createMemo(() => {
    const n = rows().length;
    return n === 0 ? 0 : n * CELL_H + (n - 1) * CELL_GAP;
  });

  createEffect(
    () => ({ width: win.width(), height: contentHeight() }),
    ({ width, height }) => win.setContentSize(width, height),
  );

  return (
    <>
      <WindowHeader height={TOOLBAR_H}>
        <box height={TOOLBAR_H} padding={PAD} flexDirection="column" gap={4} background={0}>
          <TextInput
            name="icon-gallery-search"
            value={query()}
            onChange={setQuery}
            placeholder="Find an icon…"
            width={win.width() - PAD * 2}
          />
          <box flexDirection="row" gap={6}>
            <For each={FILTERS}>
              {(item) => (
                <box
                  semantic={{ name: `icon-gallery-filter-${item.id}`, role: "button" }}
                  onClick={() => setFilter(item.id)}
                >
                  <text font="body">
                    {filter() === item.id ? `[${item.label}]` : item.label}
                  </text>
                </box>
              )}
            </For>
          </box>
          <text font="body" semantic={{ name: "icon-gallery-count", role: "status" }}>
            {`${visible().length} families`}
          </text>
        </box>
      </WindowHeader>
      <box
        semantic={{ name: "icon-gallery-grid", role: "scrollbar" }}
        width={win.width()}
        height={contentHeight()}
        flexDirection="column"
        gap={CELL_GAP}
      >
        <For each={rows()}>
          {(row) => (
            <box flexDirection="row" height={CELL_H}>
              <For each={row}>
                {(family) => {
                  const sprite = familyPreview(family);
                  const active = () => familyKey(selected() ?? family) === familyKey(family);
                  return (
                    <box
                      width={CELL_W}
                      height={CELL_H}
                      flexDirection="column"
                      alignItems="center"
                      gap={2}
                      background={active() ? 1 : 0}
                      onClick={() => setSelectedId(familyKey(family))}
                    >
                      <box width={32} height={32} alignItems="center" justifyContent="center">
                        <Show when={sprite}>
                          {(s) => (
                            <image
                              width={s().width}
                              height={s().height}
                              src={imageSrc(s())}
                              mode={active() ? "inverted" : undefined}
                            />
                          )}
                        </Show>
                      </box>
                      <text font="body" color={active() ? 0 : 1} align="center">
                        {truncate(familyLabel(family), 10)}
                      </text>
                    </box>
                  );
                }}
              </For>
            </box>
          )}
        </For>
      </box>
      <WindowFooter height={FOOTER_H}>
        <box height={FOOTER_H} padding={PAD} flexDirection="column" gap={2} background={0}>
          <Show when={selected()}>
            {(family) => (
              <text font="body" semantic={{ name: "icon-gallery-selection", role: "status" }}>
                {`${familyLabel(family())}  ${ICON_GROUP_LABEL[family().group]}  ${family().id}`}
              </text>
            )}
          </Show>
          <box flexDirection="row" gap={6} height={50}>
            <For each={members()}>{(member) => <MemberTile member={member} />}</For>
          </box>
        </box>
      </WindowFooter>
    </>
  );
}

function familyKey(family: IconFamily): string {
  return `${family.source}:${family.group}:${family.id}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function memberLabel(member: IconFamilyMember): string {
  const frame = member.frame ? `/${member.frame}` : "";
  return `${member.kind}${frame}`;
}

function MemberTile(props: { member: IconFamilyMember }): JSX.Element {
  const m = () => props.member;
  return (
    <box
      width={40}
      height={50}
      flexDirection="column"
      alignItems="center"
      gap={1}
      semantic={{ name: `icon-gallery-member-${m().kind}`, role: "img", value: memberLabel(m()) }}
    >
      <box
        width={32}
        height={32}
        alignItems="center"
        justifyContent="center"
        borderWidth={m().sprite ? 0 : 1}
        borderColor={m().sprite ? undefined : 1}
      >
        <Show when={m().sprite}>
          {(s) => <image width={s().width} height={s().height} src={imageSrc(s())} />}
        </Show>
      </box>
      <text font="body">{`${memberLabel(m())} ${m().width}`}</text>
    </box>
  );
}

/** System 7's generic Application family: its ICN# and the ics# Apple drew to go with it. */
const catalogFamily = (() => {
  const rec = (catalogFile.families as CatalogFamilyRecord[]).find(
    (f) => f.group === "system" && f.id === -3996 && f.icn
  );
  return rec ? familyFromRecord(rec) : undefined;
})();

export default defineApp({
  id: "icon_gallery",
  title: "Icon Gallery",
  icon: "icon-gallery/icon",
  smallIcon: "icon-gallery/icon-16x16",
  defaultSize: { width: 420, height: 280 },
  minSize: { width: 280, height: 80 },
  resizable: true,
  scrollable: true,
  singleInstance: true,
  sprites:
    catalogFamily?.icn && catalogFamily.ics
      ? { "icon-gallery/icon": catalogFamily.icn, "icon-gallery/icon-16x16": catalogFamily.ics }
      : undefined,
  Component: IconGallery,
});
