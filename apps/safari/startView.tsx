import { For, Show, createEffect, createSignal, onCleanup, useApp, type AppScheduler } from "@mockintosh/sdk";
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
/** How long a tile takes to glide to a new place. */
const GLIDE_MS = 140;
/** A tile's height before it's measured: the frame, the gap, two lines of name. */
const TILE_H = FRAME + 4 + 24;

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
function SiteIcon(props: { bookmark: Bookmark; icons?: FaviconLoader }): JSX.Element {
  const app = useApp();
  const icon = props.bookmark.icon;
  const sprite = icon ? app.getSprite(icon) : undefined;
  const src = sprite ? null : faviconUrl(props.bookmark.url, icon);
  const known = src ? props.icons?.peek(src) : undefined;
  const [bits, setBits] = createSignal<Uint8Array | null>(known ?? null);
  if (src && props.icons && known === undefined) void props.icons.load(src).then((loaded) => setBits(loaded));

  const letter = () => (
    <text font="newYork" size={24} nowrap>{props.bookmark.title.slice(0, 1).toUpperCase()}</text>
  );
  return (
    <TileFrame pressed={false}>
      <Show
        when={sprite}
        fallback={
          <Show when={bits()} fallback={letter()}>
            {(pixels) => <bitmap pixels={pixels()} width={FAVICON_SIZE} height={FAVICON_SIZE} />}
          </Show>
        }
      >
        {(art) => <image src={art()} width={art().width} height={art().height} />}
      </Show>
    </TileFrame>
  );
}

function TileLabel(props: { text: string; pressed?: boolean }): JSX.Element {
  return (
    <box alignSelf="stretch" alignItems="center">
      <text font="body" wrap align="center" color={props.pressed ? 0 : 1} background={props.pressed ? 1 : 0}>
        {props.text}
      </text>
    </box>
  );
}

/** A favorite being dragged to a new place, while editing: where in it it was grabbed, then the pointer on the screen. */
interface TileDrag {
  onStart(bookmark: Bookmark, grabX: number, grabY: number, x: number, y: number): void;
  onMove(bookmark: Bookmark, x: number, y: number): void;
  onEnd(bookmark: Bookmark): void;
}

function FavoriteTile(props: {
  bookmark: Bookmark;
  editing: boolean;
  icons?: FaviconLoader;
  drag: TileDrag;
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
  // While editing, a tile drags to a new place; the grid works out where.
  return (
    <box
      {...press.rootProps()}
      semantic={{ name: `safari-favorite-${props.bookmark.title}`, role: "link" }}
      cursor={props.editing ? undefined : "pointer"}
      width={TILE_W}
      flexDirection="column"
      alignItems="center"
      gap={4}
      onDragStart={(lx: number, ly: number, x: number, y: number) => {
        if (props.editing) props.drag.onStart(props.bookmark, lx, ly, x, y);
      }}
      onDrag={(_lx: number, _ly: number, x: number, y: number) => {
        if (props.editing) props.drag.onMove(props.bookmark, x, y);
      }}
      onDragEnd={() => {
        if (props.editing) props.drag.onEnd(props.bookmark);
      }}
    >
      <SiteIcon bookmark={props.bookmark} icons={props.icons} />
      <TileLabel text={props.bookmark.title} />
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
 * A place that eases to `target` whenever it moves, as a tile glides to a
 * new slot; while `follow` holds, it keeps to the target at once (a tile
 * under the pointer).
 */
function createGlide(target: () => { x: number; y: number }, follow: () => boolean, scheduler: AppScheduler): () => { x: number; y: number } {
  let now = target();
  const [at, setAt] = createSignal(now);
  const place = (next: { x: number; y: number }) => {
    now = next;
    setAt(next);
  };
  let cancel: (() => void) | null = null;
  createEffect(
    () => ({ to: target(), jump: follow() }),
    ({ to, jump }) => {
      cancel?.();
      cancel = null;
      if (jump) return place(to);
      const from = now;
      if (from.x === to.x && from.y === to.y) return;
      const start = scheduler.now();
      const step = () => {
        const t = Math.min(1, (scheduler.now() - start) / GLIDE_MS);
        const eased = 1 - (1 - t) ** 3;
        place({ x: Math.round(from.x + (to.x - from.x) * eased), y: Math.round(from.y + (to.y - from.y) * eased) });
        cancel = t < 1 ? scheduler.requestFrame(step) : null;
      };
      cancel = scheduler.requestFrame(step);
    },
  );
  onCleanup(() => cancel?.());
  return at;
}

/**
 * The start page as Safari draws it: "Favorites" over a grid of the
 * bookmarks, each the site's own icon in one bit inside a rounded square.
 * Edit puts a delete badge on each and an Add tile at the end, and lets a
 * favorite be dragged to a new place: it follows the pointer, the others
 * glide aside to leave a gap where it would land, and the order is kept
 * when it's let go, the tile gliding into its place.
 */
export function StartView(props: StartViewProps): JSX.Element {
  const app = useApp();
  const columns = () => favoritesColumns(props.width);
  // One tile per bookmark for as long as it lives, so editing doesn't redraw every icon.
  const tileOf = new WeakMap<Bookmark, Tile>();
  /** The favorite being dragged: where it would go, and the tile's top-left under the pointer. */
  const [dragging, setDragging] = createSignal<{ bookmark: Bookmark; to: number; x: number; y: number; grabX: number; grabY: number } | null>(null);
  /** The favorites in the order shown: while dragging, with the dragged one where it would go. */
  const ordered = (): readonly Bookmark[] => {
    const bookmarks = props.bookmarks ?? [];
    const drag = dragging();
    return drag ? moveBookmark(bookmarks, drag.bookmark, drag.to) : bookmarks;
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

  // Every tile has a slot on an even grid: a row as tall as the tallest tile.
  const [tallest, setTallest] = createSignal(TILE_H);
  const pitchX = TILE_W + TILE_GAP;
  const pitchY = () => tallest() + ROW_GAP;
  const slot = (index: number) => ({ x: (index % columns()) * pitchX, y: Math.floor(index / columns()) * pitchY() });
  const rowCount = () => Math.max(1, Math.ceil(tiles().length / columns()));
  const gridWidth = () => columns() * TILE_W + (columns() - 1) * TILE_GAP;
  const canEdit = () => (props.bookmarks?.length ?? 0) > 0 || props.editing;

  let grid: CanvasNode | undefined;
  /** A point on the screen in the grid's own pixels. */
  const local = (x: number, y: number) => ({ x: x - (grid?.layout.x ?? 0), y: y - (grid?.layout.y ?? 0) });
  const drag: TileDrag = {
    onStart(bookmark, grabX, grabY, x, y) {
      const at = (props.bookmarks ?? []).indexOf(bookmark);
      if (at < 0) return;
      const point = local(x, y);
      setDragging({ bookmark, to: at, x: point.x - grabX, y: point.y - grabY, grabX, grabY });
    },
    onMove(bookmark, x, y) {
      const drag = dragging();
      if (!drag || drag.bookmark !== bookmark) return;
      const point = local(x, y);
      const left = point.x - drag.grabX;
      const top = point.y - drag.grabY;
      // It would land in the slot nearest where it is now.
      const count = (props.bookmarks ?? []).length;
      const column = Math.max(0, Math.min(columns() - 1, Math.round(left / pitchX)));
      const row = Math.max(0, Math.round(top / pitchY()));
      setDragging({ ...drag, x: left, y: top, to: Math.max(0, Math.min(count - 1, row * columns() + column)) });
    },
    onEnd(bookmark) {
      const drag = dragging();
      // The new order first, so the tiles never see the old one again; then the tile glides into its slot.
      if (drag && drag.bookmark === bookmark && (props.bookmarks ?? []).indexOf(bookmark) !== drag.to) props.onMove?.(bookmark, drag.to);
      setDragging(null);
    },
  };

  /** The tiles to draw, the dragged one last so it passes over the rest. */
  const drawn = () => {
    const all = tiles();
    const held = dragging()?.bookmark;
    return held ? [...all.filter((tile) => tile.kind !== "bookmark" || tile.bookmark !== held), ...all.filter((tile) => tile.kind === "bookmark" && tile.bookmark === held)] : all;
  };

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
        <box
          ref={(node: CanvasNode) => {
            grid = node;
          }}
          width={gridWidth()}
          height={rowCount() * pitchY() - ROW_GAP}
        >
          <For each={drawn()}>
            {(tile) => {
              const held = () => tile.kind === "bookmark" && dragging()?.bookmark === tile.bookmark;
              const target = () => {
                const drag = dragging();
                return drag && held() ? { x: drag.x, y: drag.y } : slot(tiles().indexOf(tile));
              };
              const at = createGlide(target, held, app.scheduler);
              return (
                <box
                  position="absolute"
                  left={at().x}
                  top={at().y}
                  onLayout={({ height }) => {
                    if (height > tallest()) setTallest(height);
                  }}
                >
                  {tile.kind === "add" ? (
                    <AddTile onAdd={props.onAdd} />
                  ) : (
                    <FavoriteTile
                      bookmark={tile.bookmark}
                      editing={props.editing}
                      drag={drag}
                      icons={props.icons}
                      onOpen={props.onOpen}
                      onDelete={props.onDelete}
                    />
                  )}
                </box>
              );
            }}
          </For>
        </box>
      </box>
    </box>
  );
}
