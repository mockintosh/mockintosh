import { createMemo, createEffect, Show, Loading } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import {
  useApp,
  defineApp,
  Errored,
  IMAGE_TYPES,
  MIME,
  readSpriteFile,
  readPaintFile,
  paintToSprite,
  showPrintDialog,
  toBits,
  type AppContext,
  type FileDocumentProps,
  type MenubarItemDef,
  type PrintableImage,
  type PrintDialogChoice,
} from "@mockintosh/sdk";
import { sprites } from "./preview/icons";

/**
 * Preview — the default viewer for pictures. Sprite files (the native 1-bit
 * format) draw pixel for pixel; other stills are decoded and Atkinson-dithered
 * only so a 1-bit screen can show them. Editing lives in other apps, which
 * File › Open in … hands the document to.
 */

const APP_ID = "preview";
const DECODE_MAX = 1024;
const WINDOW_MAX = { width: 480, height: 320 };
const WINDOW_MIN = { width: 160, height: 100 };

type PreviewProps = Partial<FileDocumentProps> & Record<string, unknown>;

/** A picture as Preview shows it: 1 byte per pixel, `0` white, `1` black. */
interface ShownPicture {
  width: number;
  height: number;
  pixels: Uint8Array;
}

async function loadPicture(app: AppContext, fileId: string): Promise<ShownPicture> {
  const file = app.fs.file(fileId);
  if (!file) throw new Error("The picture could not be found.");
  if (file.type === MIME.sprite) {
    const sprite = await readSpriteFile(app.fs, fileId);
    if (!sprite) throw new Error(`Couldn't read "${file.name}".`);
    return { width: sprite.width, height: sprite.height, pixels: sprite.data };
  }
  if (file.type === MIME.paint) {
    const doc = await readPaintFile(app.fs, fileId);
    if (!doc) throw new Error(`Couldn't read "${file.name}".`);
    const page = paintToSprite(doc);
    return { width: page.width, height: page.height, pixels: page.data };
  }
  if (!app.images) throw new Error(`This Macintosh cannot decode "${file.name}".`);
  const bytes = await app.fs.readBytes(fileId);
  if (!bytes) throw new Error(`Couldn't read "${file.name}".`);
  const frame = await app.images.decode(bytes, file.type, { maxWidth: DECODE_MAX, maxHeight: DECODE_MAX });
  return { width: frame.width, height: frame.height, pixels: toBits(frame, "atkinson") };
}

function windowSizeFor(picture: ShownPicture): { width: number; height: number } {
  return {
    width: Math.max(WINDOW_MIN.width, Math.min(WINDOW_MAX.width, picture.width)),
    height: Math.max(WINDOW_MIN.height, Math.min(WINDOW_MAX.height, picture.height)),
  };
}

function Preview(props: PreviewProps): JSX.Element {
  const app = useApp();
  const win = app.window;
  const fileId = () => (typeof props.fileId === "string" ? props.fileId : undefined);
  const title = () => (typeof props.title === "string" ? props.title : undefined);

  const loaded = createMemo(async () => {
    const id = fileId();
    return id ? loadPicture(app, id) : null;
  });

  createEffect(
    () => title(),
    (name) => {
      if (name) win.setTitle(name);
    },
  );

  // Kept outside the reactive graph so menu clicks read what is on screen now.
  let shown: ShownPicture | null = null;
  let lastPrint: PrintDialogChoice | undefined;

  async function printPicture(): Promise<void> {
    const picture = shown;
    if (!app.print || !picture) return;
    const image: PrintableImage = { width: picture.width, height: picture.height, data: picture.pixels };
    const choice = await showPrintDialog(app, { image, documentName: title(), options: lastPrint });
    if (!choice) return;
    lastPrint = choice;
    try {
      await app.print.printPicture(image, choice);
    } catch (err) {
      await app.os.showDialog({
        message: `Couldn't print: ${err instanceof Error ? err.message : String(err)}`,
        buttons: ["OK"],
      });
    }
  }

  createEffect(
    () => ({ id: fileId(), name: title(), canPrint: !!app.print }),
    ({ id, name, canPrint }) => {
      const file = id ? app.fs.file(id) : undefined;
      const others = file ? app.os.openersFor(file.type).filter((opener) => opener.appId !== APP_ID) : [];
      const openWith: MenubarItemDef[] = others.map((opener) => ({
        label: `Open in ${opener.title}`,
        onClick: () => app.os.openApp(opener.appId, { fileId: id!, title: name ?? file!.name }),
      }));
      app.setMenus([
        {
          label: "File",
          items: [
            ...openWith,
            ...(openWith.length ? [{ type: "separator" as const }] : []),
            ...(canPrint
              ? [
                  { label: "Print…", shortcut: "P", disabled: !id, onClick: () => void printPicture() },
                  { type: "separator" as const },
                ]
              : []),
            { label: "Close", shortcut: "W", onClick: () => win.close() },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
      ]);
    },
  );

  const message = (text: string) => (
    <box width={win.width()} height={win.height()} justifyContent="center" alignItems="center" padding={12}>
      <text font="menu" spacing={1} align="center" wrap>{text}</text>
    </box>
  );

  return (
    <Show when={fileId()} fallback={message("Open a picture from the Finder.")}>
      <Loading fallback={message("Opening…")}>
        <Errored fallback={(err) => message(err instanceof Error ? err.message : String(err))}>
          {(() => {
            const picture = loaded();
            shown = picture;
            if (!picture) return message("The picture could not be found.");
            return (
              <box
                width={Math.max(win.width(), picture.width)}
                height={Math.max(win.height(), picture.height)}
                justifyContent="center"
                alignItems="center"
                background={0}
              >
                <raster
                  width={picture.width}
                  height={picture.height}
                  semantic={{ name: "picture", role: "preview" }}
                  onPaint={({ blitPixels }) => blitPixels(picture.pixels, picture.width, picture.height)}
                />
              </box>
            );
          })()}
        </Errored>
      </Loading>
    </Show>
  );
}

export default defineApp<PreviewProps>({
  id: APP_ID,
  title: "Preview",
  icon: "preview/icon",
  smallIcon: "preview/icon-16x16",
  sprites,
  about: {
    version: "1.0",
    description: "Shows pictures. Open them in another app to change them.",
  },
  defaultSize: { width: 256, height: 256 },
  minSize: WINDOW_MIN,
  scrollable: true,
  resizable: true,
  fileTypes: [MIME.sprite, ...IMAGE_TYPES, { type: MIME.paint, rank: "alternate" }],
  Component: Preview,
  onOpen(app, props) {
    const id = typeof props.fileId === "string" ? props.fileId : undefined;
    if (!id) {
      app.openWindow({ props });
      return;
    }
    // Size the window to the picture; if it can't be read, the window says why.
    // The OS ends an instance that has no window once onOpen returns, so hold
    // it open until the read settles.
    const release = app.keepAlive?.() ?? (() => {});
    void loadPicture(app, id)
      .then(
        (picture) => app.openWindow({ props, size: windowSizeFor(picture) }),
        () => app.openWindow({ props }),
      )
      .finally(release);
  },
});
