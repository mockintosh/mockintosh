/**
 * The apps bundled with the web build. Always-on apps are registered up front.
 * The rest are listings: the App Store installs them. Each module exports its
 * app as a `defineApp` result, exactly as a third-party bundle would. Apps
 * are registered from their declarations (`apps/declarations.generated.json`),
 * so the page loads an app's code only if it has to run it on the OS's
 * thread; in a process the app loads it there. The Finder registers itself:
 * it is part of the shell and the boot sequence depends on it. App Store and
 * Icon Gallery are shell apps too and are loaded here.
 */
import { registerApp } from "./os/apps";
import { registerBundledApp } from "./os/bundledApps";
import { declaredApp, type AppDeclaration } from "./os/appDeclaration";
import { APP_MODULES } from "./appModules";
import declarations from "@/apps/declarations.generated.json";
import AppStore from "@/apps/AppStore";
import IconGallery from "@/apps/IconGallery";
import { sprites as ditherSprites } from "@/apps/dither/icons";
import { sprites as traceSprites } from "@/apps/trace/icons";
import { spotifySprites } from "@/apps/sprites/spotify";
import { sprites as appleMusicSprites } from "@/apps/applemusic/icons";
import { sprites as macpaintSprites } from "@/apps/macpaint/icons";
import { sprites as canvasSprites } from "@/apps/canvas/icons";
import { sprites as surfaceSprites } from "@/apps/surface/icons";
import { sprites as synthSprites } from "@/apps/synth/icons";
import { sprites as chordSprites } from "@/apps/chord/icons";
import { sprites as op1Sprites } from "@/apps/op1/icons";
import { sprites as tp7Sprites } from "@/apps/tp7/icons";
import { sprites as pchkraftSprites } from "@/apps/pchkraft/icons";
import { sprites as visualizerSprites } from "@/apps/visualizer/icons";
import { sprites as earthSprites } from "@/apps/earth/icons";
import { sprites as foundrySprites } from "@/apps/foundry/icons";

const declared = declarations as Record<string, AppDeclaration>;

for (const app of [AppStore, IconGallery]) registerApp(app);

for (const id of ["testing", "file", "preview", "video", "photobooth", "safari", "maps", "showreel", "terminal"]) {
  registerApp(declaredApp(declared[id]!, APP_MODULES[id]!));
}

registerBundledApp({
  id: "dither",
  declaration: declared["dither"],
  title: "Dither",
  description: "Turns a photograph into a 1-bit picture.",
  icon: "dither/icon",
  sprites: ditherSprites,
  requires: ["images"],
  load: () => import("@/apps/Dither"),
});

registerBundledApp({
  id: "trace",
  declaration: declared["trace"],
  title: "Trace",
  description: "Recovers a 1-bit bitmap from a screenshot of pixel art.",
  icon: "trace/icon",
  sprites: traceSprites,
  requires: ["images"],
  load: () => import("@/apps/Trace"),
});

registerBundledApp({
  id: "assistant",
  declaration: declared["assistant"],
  title: "Assistant",
  description: "A chat window onto a language model that can use this Macintosh.",
  icon: "icon/chat",
  requires: ["network"],
  permissions: ["kernel:*"],
  load: () => import("@/apps/Assistant"),
});

registerBundledApp({
  id: "spotify",
  declaration: declared["spotify"],
  title: "Spotify Player",
  description: "Plays your Spotify library.",
  icon: "icon/spotify",
  sprites: spotifySprites,
  requires: ["network", "browser", "sign-in"],
  load: () => import("@/apps/SpotifyPlayer"),
});

registerBundledApp({
  id: "applemusic",
  declaration: declared["applemusic"],
  title: "Apple Music",
  description: "Plays your Apple Music library.",
  icon: "applemusic/icon",
  sprites: appleMusicSprites,
  requires: ["network", "browser"],
  load: () => import("@/apps/AppleMusic"),
});

registerBundledApp({
  id: "macpaint",
  declaration: declared["macpaint"],
  title: "MacPaint",
  description: "Paint in one bit, with the brushes, patterns and tools of the original Macintosh.",
  icon: "macpaint/icon",
  sprites: macpaintSprites,
  load: () => import("@/apps/MacPaint"),
});

registerBundledApp({
  id: "canvas",
  declaration: declared["canvas"],
  title: "Canvas",
  description: "Draw with objects — move, resize, and edit shapes and text without flattening to a bitmap.",
  icon: "canvas/icon",
  sprites: canvasSprites,
  load: () => import("@/apps/Canvas"),
});

registerBundledApp({
  id: "surface",
  declaration: declared["surface"],
  title: "Surface",
  description: "Plots z = f(x, y, t) as a 3D mesh you can orbit.",
  icon: "surface/icon",
  sprites: surfaceSprites,
  load: () => import("@/apps/Surface"),
});

registerBundledApp({
  id: "foundry",
  declaration: declared["foundry"],
  title: "Foundry",
  description: "Rasterizes TrueType and OpenType fonts into 1-bit bitmap strikes, which you can then tune pixel by pixel.",
  icon: "foundry/icon",
  sprites: foundrySprites,
  load: () => import("@/apps/Foundry"),
});

registerBundledApp({
  id: "synth",
  declaration: declared["synth"],
  title: "Synthesizer",
  description:
    "A polyphonic analog-style synthesizer with a 16-step sequencer, arpeggiator and effects. Play it with the mouse or the keys A to K.",
  icon: "synth/icon",
  sprites: synthSprites,
  requires: ["audio"],
  load: () => import("@/apps/Synth"),
});

registerBundledApp({
  id: "chord",
  declaration: declared["chord"],
  title: "Pocket Chord",
  description:
    "A pocket chord instrument. Seven buttons play the chords of a key; the joystick adds sevenths, suspensions and more. Strum, arpeggiate or pulse over a built-in rhythm box.",
  icon: "chord/icon",
  sprites: chordSprites,
  requires: ["audio"],
  load: () => import("@/apps/Chord"),
});

registerBundledApp({
  id: "op1",
  declaration: declared["op1"],
  title: "OP-1",
  description:
    "A portable synthesizer workstation in the manner of the Teenage Engineering OP-1: seven synth engines including a sampler, a drum kit, a pattern sequencer for each, a four-track tape and a mixer, all on four encoders. Play the keys A to ' ; Space runs the tape, Q shows the pattern. It starts with the Sunday Tape on; File › Open Tape has the other demos and the tapes you've saved.",
  icon: "op1/icon",
  sprites: op1Sprites,
  requires: ["audio"],
  load: () => import("@/apps/OP1"),
});

registerBundledApp({
  id: "tp7",
  declaration: declared["tp7"],
  title: "TP-7",
  description:
    "A field recorder in the manner of the Teenage Engineering TP-7. Record memos from the microphone, then hold the reel to stop the tape, spin it to scrub, or turn the ring around it to wind. Memos are WAV files in the TP-7 folder on your disk; marks are kept inside them.",
  icon: "tp7/icon",
  sprites: tp7Sprites,
  requires: ["audio"],
  load: () => import("@/apps/TP7"),
});

registerBundledApp({
  id: "pchkraft",
  declaration: declared["pchkraft"],
  title: "pchkraft",
  description:
    "A pocket groovebox and looper in the manner of the Vorimo pchkraft. Hum a melody or play the four keys; each beat of a hum becomes the chord that fits it, and the loop starts at once. Keys A S D F play, M listens, R records, Space runs the tape.",
  icon: "pchkraft/icon",
  sprites: pchkraftSprites,
  requires: ["audio"],
  load: () => import("@/apps/Pchkraft"),
});

registerBundledApp({
  id: "visualizer",
  declaration: declared["visualizer"],
  title: "Visualizer",
  description:
    "Listens to everything this Macintosh plays and draws it in one bit: scopes and meters, generative systems, the shots of Showreel's first reel, and Surface plots. Arrow keys change the picture.",
  icon: "visualizer/icon",
  sprites: visualizerSprites,
  requires: ["audio"],
  load: () => import("@/apps/Visualizer"),
});

registerBundledApp({
  id: "earth",
  declaration: declared["earth"],
  title: "Earth",
  description:
    "The whole Earth in one bit, after Google Earth: drag to turn the globe, scroll to come down to it, and fly anywhere from the Go menu. The Sun lights it as it does now, or at any hour the Time menu turns to, against the real stars. Go flies Apollo 8's free return round the Moon and home.",
  icon: "earth/icon",
  sprites: earthSprites,
  load: () => import("@/apps/Earth"),
});
