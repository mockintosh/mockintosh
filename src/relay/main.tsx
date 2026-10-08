/**
 * The sign-in relay's pages (`api/oauth/*`) in 1-bit: this redraws the
 * page's text and its button with Mockintosh's own fonts and controls, on a
 * canvas over the HTML. The HTML stays underneath for screen readers, and
 * shows as it is if this script can't run.
 *
 * The page's content is plain: paragraphs (bold in `<strong>`, small print
 * in `p.small`) and links styled `a.button`.
 */
import { mountCanvasUI } from "@mockintosh/ui/web";
import { DialogButton, For, type JSX, type TextRun } from "@mockintosh/ui";

type Block =
  | { kind: "text"; runs: TextRun[]; small: boolean }
  | { kind: "button"; label: string; href: string };

const CONTENT_ID = "content";
/** Page pixels per screen pixel. */
const SCALE = 2;
/** Widest the text runs, in screen pixels, so lines stay short on a desktop browser. */
const MEASURE = 260;
const PADDING = 12;

function readBlocks(content: Element): Block[] {
  const blocks: Block[] = [];
  for (const element of Array.from(content.children)) {
    if (element instanceof HTMLAnchorElement) {
      blocks.push({ kind: "button", label: element.textContent?.trim() ?? "", href: element.href });
    } else if (element.tagName === "P") {
      const runs: TextRun[] = Array.from(element.childNodes).map((node) => ({
        text: node.textContent ?? "",
        bold: node.nodeName === "STRONG",
      }));
      blocks.push({ kind: "text", runs, small: element.classList.contains("small") });
    }
  }
  return blocks;
}

function RelayPage(props: { blocks: readonly Block[] }): JSX.Element {
  return (
    <box width="100%" height="100%" background={0} justifyContent="center" alignItems="center" padding={PADDING}>
      <box width="100%" maxWidth={MEASURE} flexDirection="column" alignItems="center" gap={12}>
        <For each={props.blocks}>
          {(block) =>
            block.kind === "button" ? (
              <DialogButton label={block.label} default onClick={() => window.location.assign(block.href)} />
            ) : (
              <text font={block.small ? "body" : "menu"} wrap align="center" width="100%" runs={block.runs} />
            )
          }
        </For>
      </box>
    </box>
  );
}

const content = document.getElementById(CONTENT_ID);
const root = document.getElementById("screen");
if (content && root) {
  const blocks = readBlocks(content);
  mountCanvasUI({ root, size: { mode: "viewport", scale: SCALE }, component: () => <RelayPage blocks={blocks} /> });
  document.documentElement.classList.add("drawn");
}
