/**
 * The apps bundled with the web build. Always-on apps are registered up front.
 * The rest are listings: the App Store installs them, and their modules load
 * then. Each module exports its app as a `defineApp` result, exactly as a
 * third-party bundle would. The Finder registers itself: it is part of the
 * shell and the boot sequence depends on it.
 */
import { registerApp } from "./os/apps";
import { registerBundledApp } from "./os/bundledApps";
import Testing from "@/apps/Testing";
import FileViewer from "@/apps/FileViewer";
import Preview from "@/apps/Preview";
import VideoPlayer from "@/apps/VideoPlayer";
import PhotoBooth from "@/apps/PhotoBooth";
import AppStore from "@/apps/AppStore";
import Safari from "@/apps/Safari";
import IconGallery from "@/apps/IconGallery";
import Showreel from "@/apps/Showreel";
import { sprites as ditherSprites } from "@/apps/dither/icons";
import { sprites as traceSprites } from "@/apps/trace/icons";
import { spotifySprites } from "@/apps/sprites/spotify";
import { sprites as macpaintSprites } from "@/apps/macpaint/icons";
import { sprites as canvasSprites } from "@/apps/canvas/icons";
import { sprites as surfaceSprites } from "@/apps/surface/icons";
import { sprites as synthSprites } from "@/apps/synth/icons";
import { sprites as chordSprites } from "@/apps/chord/icons";
import { sprites as op1Sprites } from "@/apps/op1/icons";

for (const app of [
  Testing,
  FileViewer,
  Preview,
  VideoPlayer,
  PhotoBooth,
  AppStore,
  Safari,
  IconGallery,
  Showreel,
]) {
  registerApp(app);
}

registerBundledApp({
  id: "dither",
  title: "Dither",
  description: "Turns a photograph into a 1-bit picture.",
  icon: "dither/icon",
  sprites: ditherSprites,
  requires: ["images"],
  load: () => import("@/apps/Dither"),
});

registerBundledApp({
  id: "trace",
  title: "Trace",
  description: "Recovers a 1-bit bitmap from a screenshot of pixel art.",
  icon: "trace/icon",
  sprites: traceSprites,
  requires: ["images"],
  load: () => import("@/apps/Trace"),
});

registerBundledApp({
  id: "chatgippity",
  title: "ChatGippity",
  description: "A chat window onto a language model that can use this Macintosh.",
  icon: "icon/computer",
  requires: ["network"],
  permissions: ["kernel:*"],
  load: () => import("@/apps/ChatGippity"),
});

registerBundledApp({
  id: "fx",
  title: "fx",
  description:
    "The fx coding agent from Vercel Labs, running on this Macintosh. It reads and edits files, builds apps, and clicks around to check its work. Bring your own Vercel AI Gateway key.",
  icon: "icon/chat",
  requires: ["network", "agent-runtime"],
  permissions: ["kernel:*"],
  load: () => import("@/apps/Fx"),
});

registerBundledApp({
  id: "spotify",
  title: "Spotify Player",
  description: "Plays your Spotify library.",
  icon: "icon/spotify",
  sprites: spotifySprites,
  requires: ["network", "browser", "sign-in"],
  load: () => import("@/apps/SpotifyPlayer"),
});

registerBundledApp({
  id: "macpaint",
  title: "MacPaint",
  description: "Paint in one bit, with the brushes, patterns and tools of the original Macintosh.",
  icon: "macpaint/icon",
  sprites: macpaintSprites,
  load: () => import("@/apps/MacPaint"),
});

registerBundledApp({
  id: "canvas",
  title: "Canvas",
  description: "Draw with objects — move, resize, and edit shapes and text without flattening to a bitmap.",
  icon: "canvas/icon",
  sprites: canvasSprites,
  load: () => import("@/apps/Canvas"),
});

registerBundledApp({
  id: "surface",
  title: "Surface",
  description: "Plots z = f(x, y, t) as a 3D mesh you can orbit.",
  icon: "surface/icon",
  sprites: surfaceSprites,
  load: () => import("@/apps/Surface"),
});

registerBundledApp({
  id: "synth",
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
  title: "OP-1",
  description:
    "A portable synthesizer workstation in the manner of the Teenage Engineering OP-1: seven synth engines including a sampler, a drum kit, a pattern sequencer for each, a four-track tape and a mixer, all on four encoders. Play the keys A to ' ; Space runs the tape, Q shows the pattern. It starts with the Sunday Tape on; File › Open Tape has the other demos and the tapes you've saved.",
  icon: "op1/icon",
  sprites: op1Sprites,
  requires: ["audio"],
  load: () => import("@/apps/OP1"),
});



