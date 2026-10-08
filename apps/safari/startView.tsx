import { For, Show, createSignal, useApp } from "@mockintosh/sdk";
import { createPress, type CanvasNode, type JSX } from "@mockintosh/ui";
import { moveBookmark, type Bookmark } from "./bookmarks";
import { faviconUrl, type FaviconLoader } from "./favicon";
import { deleteBadgeIcon, plusIcon, scaled } from "./icons";

/** Each site icon's square, inside its 1px frame. */
export const FAVICON_SIZE = 48;
const FRAME = FAVICON_SIZE + 2;
const RADIUS = 9;
/** A tile is the framed icon over a two-line name. */
const TILE_W = 64;
const TILE_GAP = 12;
const ROW_GAP = 10;
/** Widest the grid grows before it centres in the window, as Safari's does. */
const MAX_COLUMNS = 6;
/** The delete badge sits on the frame's top-left corner. */
const BADGE_LEFT = (TILE_W - FRAME) / 2 - 6;
const BADGE_TOP = -6;
const ADD_ICON = scaled(plusIcon, 2);

export interface StartViewProps {
  /** `null` until they are read from the preferences file. */
  bookmarks: readonly Bookmark[] | null;
  /** Inner width of the page, for how many tiles fit in a row. */
  width: number;
  /** Showing delete badges and the Add tile. */
  editing: boolean;
  /** Site icons at `FAVICON_SIZE`. */
  icons?: FaviconLoader;
  onOpen(url: string): void;
  onEditingChange(editing: boolean): void;
  onDelete(bookmark: Bookmark): void;
  /** While editing, a favorite dragged to a new place: it goes to `to` in the list. */
  onMove?(bookmark: Bookmark, to: number): void;
  onAdd(): void;
}

type Tile = { kind: "bookmark"; bookmark: Bookmark } | { kind: "add" };

const ADD_TILE: Tile = { kind: "add" };

/** How many tiles fit across `width`. */
export function favoritesColumns(width: number): number {
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + TILE_GAP) / (TILE_W + TILE_GAP))));
}

function inverted(bits: Uint8Array): Uint8Array {
  return bits.map((bit) => 1 - bit);
}

/** A rounded square around a tile's picture. */
function TileFrame(props: { pressed: boolean; children: JSX.Element }): JSX.Element {
  // The frame goes on top: a white icon would paint over the corners' arcs.
  return (
    <box
      width={FRAME}
      height={FRAME}
      padding={1}
      borderRadius={RADIUS}
      overflow="hidden"
      background={props.pressed ? 1 : 0}
      justifyContent="center"
      alignItems="center"
    >
      {props.children}
      <box position="absolute" left={0} top={0} width={FRAME} height={FRAME} borderColor={1} borderRadius={RADIUS} />
    </box>
  );
}

/** The site's picture; its letter while there is none. */
function SiteIcon(props: { bookmark: Bookmark; icons?: FaviconLoader; pressed: boolean }): JSX.Element {
  const app = useApp();
  const icon = props.bookmark.icon;
  const sprite = icon ? app.getSprite(icon) : undefined;
  const src = sprite ? null : faviconUrl(props.bookmark.url, icon);
  const known = src ? props.icons?.peek(src) : undefined;
  const [bits, setBits] = createSignal<Uint8Array | null>(known ?? null);
  if (src && props.icons && known === undefined) void props.icons.load(src).then((loaded) => setBits(loaded));

  const letter = () => (
    <text font="newYork" size={24} nowrap color={props.pressed ? 0 : 1}>{props.bookmark.title.slice(0, 1).toUpperCase()}</text>
  );
  return (
    <TileFrame pressed={props.pressed}>
      <Show
        when={sprite}
        fallback={
          <Show when={bits()} fallback={letter()}>
            {(pixels) => <bitmap pixels={props.pressed ? inverted(pixels()) : pixels()} width={FAVICON_SIZE} height={FAVICON_SIZE} />}
          </Show>
        }
      >
        {(art) => <image src={art()} width={art().width} height={art().height} mode={props.pressed ? "inverted" : "normal"} />}
      </Show>
    </TileFrame>
  );
}

function TileLabel(props: { text: string; pressed: boolean }): JSX.Element {
  return (
    <box alignSelf="stretch" alignItems="center">
      <text font="body" wrap align="center" color={props.pressed ? 0 : 1} background={props.pressed ? 1 : 0}>
        {props.text}
      </text>
    </box>
  );
}

/** A favorite being dragged to a new place, while editing. */
interface TileDrag {
  onStart(bookmark: Bookmark): void;
  onMove(bookmark: Bookmark, x: number, y: number): void;
  onEnd(bookmark: Bookmark): void;
}

function FavoriteTile(props: {
  bookmark: Bookmark;
  editing: boolean;
  /** Being dragged: drawn black, as a pressed tile. */
  dragged: boolean;
  icons?: FaviconLoader;
  drag: TileDrag;
  node(node: CanvasNode): void;
  onOpen(url: string): void;
  onDelete(bookmark: Bookmark): void;
}): JSX.Element {
  // While editing, only the badge does anything.
  const press = createPress({
    get disabled() {
      return props.editing;
    },
    onClick: () => props.onOpen(props.bookmark.url),
  });
  const dark = () => press.pressed() || props.dragged;
  // While editing, a tile drags to a new place; the grid works out where.
  return (
    <box
      {...press.rootProps()}
      ref={(node: CanvasNode) => props.node(node)}
      semantic={{ name: `safari-favorite-${props.bookmark.title}`, role: "link" }}
      cursor={props.editing ? undefined : "pointer"}
      width={TILE_W}
      flexDirection="column"
      alignItems="center"
      gap={4}
      onDragStart={() => {
        if (props.editing) props.drag.onStart(props.bookmark);
      }}
      onDrag={(_lx: number, _ly: number, x: number, y: number) => {
        if (props.editing) props.drag.onMove(props.bookmark, x, y);
      }}
      onDragEnd={() => {
        if (props.editing) props.drag.onEnd(props.bookmark);
      }}
    >
      <SiteIcon bookmark={props.bookmark} icons={props.icons} pressed={dark()} />
      <TileLabel text={props.bookmark.title} pressed={dark()} />
      <Show when={props.editing}>
        <box
          semantic={{ name: `safari-favorite-delete-${props.bookmark.title}`, role: "button" }}
          position="absolute"
          left={BADGE_LEFT}
          top={BADGE_TOP}
          cursor="pointer"
          onClick={() => props.onDelete(props.bookmark)}
        >
          <image src={deleteBadgeIcon} width={deleteBadgeIcon.width} height={deleteBadgeIcon.height} />
        </box>
      </Show>
    </box>
  );
}

function AddTile(props: { onAdd(): void }): JSX.Element {
  const press = createPress({ onClick: () => props.onAdd() });
  return (
    <box
      {...press.rootProps()}
      semantic={{ name: "safari-favorite-add", role: "button" }}
      cursor="pointer"
      width={TILE_W}
      flexDirection="column"
      alignItems="center"
      gap={4}
    >
      <TileFrame pressed={press.pressed()}>
        <image src={ADD_ICON} width={ADD_ICON.width} height={ADD_ICON.height} mode={press.pressed() ? "inverted" : "normal"} />
      </TileFrame>
      <TileLabel text="Add…" pressed={press.pressed()} />
    </box>
  );
}

/**
 * The start page as Safari draws it: "Favorites" over a grid of the
 * bookmarks, each the site's own icon in one bit inside a rounded square.
 * Edit puts a delete badge on each and an Add tile at the end, and lets a
 * favorite be dragged to a new place: the others make room as it goes, and
 * the order is kept when it's let go.
 */
export function StartView(props: StartViewProps): JSX.Element {
  const columns = () => favoritesColumns(props.width);
  // One tile per bookmark for as long as it lives, so editing doesn't redraw every icon.
  const tileOf = new WeakMap<Bookmark, Tile>();
  const nodeOf = new Map<Bookmark, CanvasNode>();
  /** The favorite being dragged, and where it would go. */
  const [dragging, setDragging] = createSignal<{ bookmark: Bookmark; to: number } | null>(null);
  /** The favorites in the order shown: while dragging, with the dragged one where it would go. */
  const ordered = (): readonly Bookmark[] => {
    const bookmarks = props.bookmarks ?? [];
    const drag = dragging();
    return drag ? moveBookmark(bookmarks, drag.bookmark, drag.to) : bookmarks;
  };
  const drag: TileDrag = {
    onStart(bookmark) {
      const at = (props.bookmarks ?? []).indexOf(bookmark);
      if (at >= 0) setDragging({ bookmark, to: at });
    },
    onMove(bookmark, x, y) {
      // The place is the tile nearest the pointer, as laid out now.
      let best = -1;
      let bestDistance = Infinity;
      ordered().forEach((shown, index) => {
        const node = nodeOf.get(shown);
        if (!node) return;
        const cx = node.layout.x + node.layout.width / 2;
        const cy = node.layout.y + FRAME / 2;
        const distance = (x - cx) ** 2 + (y - cy) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      if (best >= 0 && best !== dragging()?.to) setDragging({ bookmark, to: best });
    },
    onEnd(bookmark) {
      const drag = dragging();
      setDragging(null);
      if (drag && drag.bookmark === bookmark && (props.bookmarks ?? []).indexOf(bookmark) !== drag.to) props.onMove?.(bookmark, drag.to);
    },
  };
  const tiles = (): Tile[] => {
    const bookmarks = ordered();
    const out = bookmarks.map((bookmark) => {
      let tile = tileOf.get(bookmark);
      if (!tile) tileOf.set(bookmark, (tile = { kind: "bookmark", bookmark }));
      return tile;
    });
    if (props.bookmarks && (props.editing || bookmarks.length === 0)) out.push(ADD_TILE);
    return out;
  };
  const rows = () => Array.from({ length: Math.ceil(tiles().length / columns()) }, (_, row) => row);
  const rowTiles = (row: number) => tiles().slice(row * columns(), (row + 1) * columns());
  const gridWidth = () => columns() * TILE_W + (columns() - 1) * TILE_GAP;
  const canEdit = () => (props.bookmarks?.length ?? 0) > 0 || props.editing;
  return (
    <box width="100%" alignItems="center" paddingTop={12} paddingBottom={12}>
      <box width={gridWidth()} flexDirection="column" gap={ROW_GAP}>
        <box flexDirection="row" justifyContent="space-between" alignItems="flex-end">
          <text font="menu" spacing={1} nowrap>Favorites</text>
          <Show when={canEdit()}>
            <text
              semantic={{ name: "safari-favorites-edit", role: "button" }}
              font="body"
              nowrap
              runs={[{ text: props.editing ? "Done" : "Edit", underline: true, onClick: () => props.onEditingChange(!props.editing) }]}
            />
          </Show>
        </box>
        <For each={rows()}>
          {(row) => (
            <box flexDirection="row" gap={TILE_GAP} alignItems="flex-start">
              <For each={rowTiles(row)}>
                {(tile) =>
                  tile.kind === "add" ? (
                    <AddTile onAdd={props.onAdd} />
                  ) : (
                    <FavoriteTile
                      bookmark={tile.bookmark}
                      editing={props.editing}
                      dragged={dragging()?.bookmark === tile.bookmark}
                      drag={drag}
                      node={(node) => nodeOf.set(tile.bookmark, node)}
                      icons={props.icons}
                      onOpen={props.onOpen}
                      onDelete={props.onDelete}
                    />
                  )
                }
              </For>
            </box>
          )}
        </For>
      </box>
    </box>
  );
}
