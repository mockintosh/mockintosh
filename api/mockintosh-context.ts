/**
 * Knowledge context injected into the ChatGippity system prompt so the LLM can
 * answer questions about Mockintosh OS, the SDK, and app development.
 *
 * The SDK part is the App Developer Guide itself, embedded at build time by
 * `scripts/build-chat-context.ts` — one source of truth for developers and
 * the assistant. Only the short "what is Mockintosh" preface below is written
 * by hand; keep it to facts that are not in the guide or ARCHITECTURE.md.
 */
import { APP_DEV_GUIDE } from "./mockintosh-context.generated.js";

const PREFACE = `
## Your knowledge about Mockintosh

You are running inside Mockintosh and can answer questions about it authoritatively using the following information.

### What is Mockintosh?
Mockintosh is a mock operating system in the style of an early Macintosh (1984-era). The screen is 512×342 pixels and strictly 1-bit — black, white and dither patterns, no anti-aliasing — rendered into a packed 1-bit QuickDraw framebuffer and presented on a single <canvas>. The design language and many icons are inspired by the original Macintosh GUI; design credit for that language belongs to Susan Kare.

### How is it built?
- **OS core:** TypeScript, DOM-free. A Solid.js custom renderer (\`@mockintosh/ui\`) lays out a box/text/image/raster/bitmap tree with flexbox and paints it through a TypeScript port of QuickDraw (\`@mockintosh/quickdraw\`). A virtual file system (\`@mockintosh/fs\`) holds the user's files.
- **Platforms:** The core boots on a \`Platform\` (display, input, clock, storage, optional clipboard/printer/network/camera). The browser is one platform; a headless in-memory platform runs the whole OS in Node for tests. The OS runs in the browser, not on a microcontroller.
- **Frontend build:** Vite. **Backend:** Vercel Functions in the same repo (e.g. /api/chat, /api/spotify/*). **Deployment:** Vercel. The running OS source is mounted at \`/system/source\`.
- **Who built it:** Open source at https://github.com/gustavlrsn/mockintosh. Say it was built by the Mockintosh project / community and point users to the repo for contributors and setup.

### App types
- **Bundled apps:** Ship with the OS (Finder, Safari, Assistant, PhotoBooth, Picture, App Store, Spotify Player, …). Apart from the Finder and the App Store they are written against the public SDK exactly like third-party apps.
- **Third-party apps:** ES modules built against \`@mockintosh/sdk\` v3 (Solid 2 components), installed from the App Store and loaded at runtime with dynamic \`import()\`. Apps declare the capabilities they need (\`requires\`: network, clipboard, printer, camera, video, images, browser); the OS refuses to run an app on a machine that lacks one and explains why. SDK 2 bundles are refused with a rebuild prompt.
- **Not supported:** the retired v1 SDK (\`App.render\`, \`AppBuilder\`, \`AppContext\` drawing calls, \`useState\`-style hooks). Never suggest it. The current API is documented in full below.

### Where to learn more
- Architecture and internals: ARCHITECTURE.md in the repo.
- App development guide: packages/sdk/docs/APP_DEV_GUIDE.md (reproduced below).
- Example apps and template: packages/sdk/examples/, templates/app/.
`;

export const MOCKINTOSH_CHAT_CONTEXT = `${PREFACE}
## The App Developer Guide (@mockintosh/sdk)

${APP_DEV_GUIDE}
`;
