import { Button } from "@mockintosh/ui";
import type { JSX } from "@mockintosh/ui";
import { useRouter } from "../router";
import { HomeShowcase } from "./homeShowcase";

const PAGE_MAX = 800;
const HERO_MAX = 400;

export function HomePage(): JSX.Element {
  const router = useRouter();
  return (
    <box
      flexDirection="column"
      gap={16}
      padding={8}
      width="100%"
      maxWidth={PAGE_MAX}
      alignSelf="center"
    >
      <box
        flexDirection="column"
        gap={12}
        width="100%"
        maxWidth={HERO_MAX}
        alignSelf="center"
      >
        <text font="geist" wrap>
          A 1-bit renderer and UI kit for Solid.js
        </text>
        <text font="body" wrap selectable>
          Render on canvas on the web, or straight to a framebuffer. Host elements and widgets, the same packed pixels as a Macintosh, without the chrome.
        </text>
        <box flexDirection="row" gap={12} alignItems="center">
          <Button label="Docs" onClick={() => router.navigate("/docs")} />
          <Button label="Components" onClick={() => router.navigate("/components")} />
        </box>
      </box>
      <HomeShowcase />
    </box>
  );
}
