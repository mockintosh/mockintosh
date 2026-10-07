import { Show, createMemo, createEffect, Loading } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { MIME, Markdown, defineApp, useApp } from "@mockintosh/sdk";

function looksLikeMarkdown(title: string, content: string): boolean {
  if (/\.(md|markdown)$/i.test(title)) return true;
  return /^#{1,2}\s|^\*\s|^\-\s/m.test(content.slice(0, 400));
}

function FileViewer(props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  createEffect(() => true, () => {
    app.setMenus([
      { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
    ]);
  });
  const title = () => String(props.title ?? "File");
  const content = createMemo(() => {
    if (typeof props.content === "string") return props.content;
    const fileId = props.fileId as string | undefined;
    if (!fileId) return "";
    return app.fs.readText(fileId).then((text) => text ?? "");
  });

  createEffect(
    () => props.title,
    (value) => {
      if (value) win.setTitle(String(value));
    },
  );

  return (
    <box
      width={win.width()}
      height={win.height()}
      padding={8}
      overflow="scroll"
      background={0}
    >
      <Loading fallback={<text font="body">Opening…</text>}>
        <Show
          when={looksLikeMarkdown(title(), content())}
          fallback={
            <text font="body" wrap>
              {content() || " "}
            </text>
          }
        >
          <Markdown text={content()} />
        </Show>
      </Loading>
    </box>
  );
}

export default defineApp({
  id: "file",
  title: "File",
  icon: "icon/file",
  smallIcon: "icon/file-16x16",
  defaultSize: { width: 350, height: 200 },
  scrollable: true,
  fileTypes: [MIME.text, MIME.markdown, MIME.json],
  Component: FileViewer,
});
