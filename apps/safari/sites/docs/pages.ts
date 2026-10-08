/**
 * The pages of docs.mockintosh.com, as Markdown. Links that start with `/`
 * are other pages of the site.
 */
export interface DocsPage {
  /** Path on docs.mockintosh.com, `/` for the front page. */
  path: string;
  /** Title in the sidebar and the window. */
  title: string;
  markdown: string;
}

export const DOCS_PAGES: readonly DocsPage[] = [
  {
    path: "/",
    title: "Introduction",
    markdown: `# Mockintosh

Mockintosh is an operating system in the style of the first Macintosh, running in your web browser. The whole screen is 512 × 342 pixels, and every pixel is black or white: grey is a dither pattern, as it was in 1984. There is no HTML inside the screen. Everything you see, down to the menu bar and the cursor, is drawn by a port of QuickDraw into a 1-bit framebuffer.

It is also a real system to use and build on. It has a Finder and a disk that keeps your files, a Font Manager, printing to thermal printers, a web browser, music instruments, paint programs, coding agents, and an SDK for writing your own apps.

## Where to start

- [The desktop](/desktop): menus, windows, icons and the Apple menu.
- [Files and the disk](/files): where your documents live.
- [Applications](/apps): what comes with the system, and the App Store.
- [Safari](/safari): the web, drawn in one bit.
- [Fonts](/fonts) and [printing](/printing).
- [Automation](/automation): Terminal, the command line and agents.
- [Building apps](/developers): the SDK.
- [Under the hood](/under-the-hood): how it is put together.

Mockintosh is open source: [github.com/mockintosh/mockintosh](https://github.com/mockintosh/mockintosh). The design language and most icons are Susan Kare's. Macintosh, QuickDraw and Finder are trademarks of Apple Inc.; Mockintosh is not affiliated with Apple.
`,
  },
  {
    path: "/desktop",
    title: "The desktop",
    markdown: `# The desktop

The desktop is the Finder's. Disk and application icons sit along its right edge, the Trash at the bottom, and the menu bar across the top belongs to whichever application is in front.

## Icons

- Click an icon to select it; drag to move it, or drag a rectangle around several.
- Double-click to open it: a disk or folder opens a window, an application launches, and a document opens in the application that reads it.
- Drag an icon to the Trash to throw it away. Trashing an installed application uninstalls it.

## Windows

- Drag a window by its title bar. Click one to bring it to the front.
- The box at the left of the title bar closes the window; the one at the right zooms it.
- Windows that can be resized have a size box in the bottom-right corner, and a scroll bar when their contents are taller than the window.
- Some applications, like the 1984 film, take over the whole screen.

## The Apple menu

- **About This Computer** shows the system version, a link to the source and everyone who has contributed to it.
- **Control Panel** sets the desktop pattern and the date and time.
- **Chooser** picks and sets up a printer.
- **Screenshot** captures the entire screen or a portion you drag out.
- **Force Quit…** stops an application that has stopped answering.
- Shortcuts to Icon Gallery, MacPaint, Trace and Terminal.

Keyboard shortcuts work as they did: ⌘ with a letter chooses the menu item that shows it, such as ⌘N for a new window.
`,
  },
  {
    path: "/files",
    title: "Files and the disk",
    markdown: `# Files and the disk

Everything you make is kept on **Mockintosh HD**, a disk stored in your browser. It survives reloads and reboots. It is private to this browser: clearing the site's data erases it.

## Folders you'll meet

- **Applications** holds the apps you install from the App Store.
- **System Folder** holds the system's own files. Its **Fonts** folder is where fonts are installed.
- Apps keep their documents in folders of their own, such as the **TP-7** folder of voice memos.

## Opening and moving documents

Each document has a type, and each application says which types it reads. Double-clicking a document opens it in the application for its type; an application's File menu can open others. Drag documents between folder windows to move them.

## Bringing files in

Drag pictures and fonts from your computer onto the screen to copy them to the disk. They land in the folder under the pointer. Dropped on Dither, Trace or Foundry, they open there instead.
`,
  },
  {
    path: "/apps",
    title: "Applications",
    markdown: `# Applications

Some applications are always there. The rest are listed in the **App Store**, which installs them into the Applications folder. Trash an installed application to remove it.

## Always installed

- **Finder**: The desktop, folder windows, About This Computer and Control Panel.
- **App Store**: Installs and removes applications.
- **Safari**: The web, drawn in one bit.
- **Preview**: Shows pictures and sprites.
- **File**: Shows text, Markdown and JSON files.
- **Photo Booth**: Takes dithered photos with your camera.
- **1984.mp4**: The film, in one bit.
- **Showreel**: Four short films in one bit, each with its own score.
- **Icon Gallery**: Every icon in the system.

## In the App Store

- **MacPaint**: Paint with the brushes, patterns and tools of the original.
- **Canvas**: Draw with shapes and text you can move and edit later.
- **Dither**: Turns a photograph into a 1-bit picture.
- **Trace**: Recovers a 1-bit bitmap from a screenshot of pixel art.
- **Surface**: Plots z = f(x, y, t) as a 3D mesh you can orbit.
- **Foundry**: Turns TrueType and OpenType fonts into bitmap fonts you can tune pixel by pixel.
- **Synthesizer**: A polyphonic synthesizer with a step sequencer, arpeggiator and effects.
- **Pocket Chord**: Seven buttons that play the chords of a key.
- **OP-1**: A synthesizer workstation with seven engines, sequencers and a four-track tape.
- **TP-7**: A field recorder for voice memos.
- **pchkraft**: A pocket groovebox: hum a melody and it becomes the loop.
- **Visualizer**: Draws whatever the system is playing.
- **Spotify Player**: Plays your Spotify library.
- **Assistant**: A chat with a language model that can use this Macintosh.

## When an application can't run

Applications declare what they need, such as a camera, a microphone or the network. If this computer lacks it, the system says so instead of opening the application, and the App Store won't install what can't run here.
`,
  },
  {
    path: "/safari",
    title: "Safari",
    markdown: `# Safari

Safari shows the web the way it looked before style sheets: text, links, pictures and forms, in Geneva and Chicago, with every picture dithered to one bit.

- Type an address, or some words to search DuckDuckGo, in the address bar.
- **View › Reader** keeps only a page's article.
- Tabs, history and bookmarks work as you'd expect. The start page lists sites that read well without CSS.

## Sites Safari draws itself

Most pages are fetched and simplified on the Mockintosh server. A few sites are drawn from their APIs instead, laid out for the screen:

- **GitHub**: profiles, repositories, files, issues and pull requests. **Bookmarks › GitHub Token…** takes a personal access token, which raises GitHub's rate limit and opens private repositories.
- **Hacker News**: the front page, new stories, comment threads and profiles.
- **docs.mockintosh.com**: this documentation.
`,
  },
  {
    path: "/fonts",
    title: "Fonts",
    markdown: `# Fonts

Mockintosh's Font Manager works the way System 7's did. A family holds bitmap fonts at fixed sizes, drawn pixel by pixel, and may hold TrueType or OpenType outlines that are scaled to any size.

## Built in

Chicago, Geneva, Monaco and New York; the city fonts (Venice, London, Athens, San Francisco, Toronto, Cairo, Los Angeles); Lisa; Geist Pixel; Jiskan; and Redaction at 10, 14, 20, 29, 50 and 100 points in Regular, Bold and Italic.

## Choosing a face

When a style is asked for, a real bold or italic face is used if the family has one. Otherwise the style is synthesized, as QuickDraw did: bold smears each glyph a pixel to the right, and italic slants it. A bitmap drawn by hand at the exact size wins over a scaled outline.

## Installing fonts

Put a font suitcase, a TrueType or OpenType file, or a bitmap font in **System Folder › Fonts**. It is installed at once, and every application's font menu updates.

**Foundry** makes suitcases: open a TrueType font, add its bold and italic, pick the sizes to keep as bitmaps, touch them up pixel by pixel, and install.
`,
  },
  {
    path: "/printing",
    title: "Printing",
    markdown: `# Printing

Mockintosh prints to thermal receipt and label printers, over USB or Bluetooth, straight from the browser. Printouts are 1-bit, like the screen, so what you see is exactly what prints.

## Setting up a printer

1. Open **Chooser** from the Apple menu.
2. Click **Add USB…** or **Add Bluetooth…** and pick your printer.
3. Choose its driver, then set the paper width, print density and speed.
4. **Make Default** makes it the printer every Print command uses. **Print Self-Test** checks it.

Applications that print show a Print command with a preview. If this computer can't reach printers, printing is hidden.

## When a printer misbehaves

**Chooser › Diagnostics…** runs experiments against the connected printer: raw commands, status reads and test patterns. They help when a printer ignores commands or prints badly.
`,
  },
  {
    path: "/automation",
    title: "Automation",
    markdown: `# Automation

Everything you can do with the mouse, a program can do too. The system is driven by a table of operations, called traps after the Macintosh Toolbox's: reading and writing files, listing and opening applications, clicking, typing, choosing menu items, taking screenshots, and building and installing apps.

## Terminal

**Terminal**, in the Apple menu, is a shell over those operations. Type \`help\` for the list of commands.

## From your own computer

\`npm run mockintosh\` in the source repository is a command line for a running Mockintosh. Pair it with the browser once; after that, every operation is a command whose flags are the operation's inputs. The same operations are served over MCP, so an assistant on your computer can use Mockintosh.

## Agents on the Macintosh

**Assistant** is a chat with a language model that can use this Macintosh through the same operations. **fx**, run from the Terminal, is a coding agent that reads and edits files and runs commands in the shell.
`,
  },
  {
    path: "/developers",
    title: "Building apps",
    markdown: `# Building apps

A Mockintosh application is an ES module built with SolidJS and the Mockintosh SDK. Its default export is \`defineApp\`:

\`\`\`
import { defineApp, Button, createSignal } from "@mockintosh/sdk";

export default defineApp({
  id: "myapp",
  title: "My App",
  icon: "myapp/icon",
  defaultSize: { width: 200, height: 150 },
  Component() {
    const [count, setCount] = createSignal(0);
    const add = () => setCount((c) => c + 1);
    return (
      <box padding={8} gap={8}>
        <text font="menu">{\`Count: \${count()}\`}</text>
        <Button label="+1" onClick={add} />
      </box>
    );
  },
});
\`\`\`

## Drawing

There is no DOM. Components return a tree of \`box\`, \`text\`, \`image\`, \`bitmap\` and \`raster\` nodes, laid out with flexbox and painted by QuickDraw in black and white. The SDK has buttons, text fields, menus, dialogs and other controls in the system's style.

## What an app can use

\`useApp()\` is the system: files and storage, dialogs, windows and menus, fonts, sound, pictures, printing, and \`fetch\` for the network. Anything the host computer might lack is a capability: declare what your app can't run without in \`requires\`, and check the rest before using it.

## Building and shipping

- Inside Mockintosh, projects are created, built, run and edited with the project operations (see [Automation](/automation)) or by asking fx.
- Outside, build a bundle with Vite and the SDK's \`mockintoshManifest\` plugin, and publish it with its \`manifest.json\`, which the App Store reads.
- On the web, your app runs in a Web Worker of its own.

The full guide is in the repository: [APP_DEV_GUIDE.md](https://github.com/mockintosh/mockintosh/blob/main/packages/sdk/docs/APP_DEV_GUIDE.md).
`,
  },
  {
    path: "/under-the-hood",
    title: "Under the hood",
    markdown: `# Under the hood

## One bit, packed as in 1984

The screen is a QuickDraw bitmap packed exactly as on the original Macintosh: eight pixels to a byte, a 1 for black, rows padded to 16 bits. A whole screen is 22 KB. The same bytes can go to a 1-bit display or a thermal printer unchanged.

## QuickDraw

The drawing engine is a port of QuickDraw: GrafPorts, regions, patterns, CopyBits and the Font Manager, following the original source and Inside Macintosh.

## The UI kit

A SolidJS renderer keeps a tree of boxes and text, lays it out and paints it through QuickDraw. It is published separately as a 1-bit UI kit, at [ui.mockintosh.com](https://ui.mockintosh.com).

## The platform

The system asks the machine for a small set of things: a screen, a mouse and keyboard, a clock and a disk. Everything else is a peripheral: network, clipboard, printers, camera, microphone, speaker. When a peripheral is missing, the features that need it are hidden. The browser is one platform; the same system boots headless in tests.

## Processes

On the web, most applications run in a Web Worker of their own and draw their windows there. The Finder, App Store and Icon Gallery are part of the shell and run with it, as do the few apps that need something a worker can't provide.

For the details, read [ARCHITECTURE.md](https://github.com/mockintosh/mockintosh/blob/main/ARCHITECTURE.md).
`,
  },
];
