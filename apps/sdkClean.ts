/**
 * The bundled-app manifest: which entries compile as user projects (SDK-clean)
 * and which are part of the shell. `sdkClean.test.ts` and the App Developer
 * Guide table both read this file so the three stay in lockstep.
 */

/** App entry files under `apps/` that must compile through the in-OS builder. */
export const SDK_CLEAN = [
  "MacPaint.tsx",
  "Canvas.tsx",
  "Foundry.tsx",
  "Safari.tsx",
  "Maps.tsx",
  "Testing.tsx",
  "FileViewer.tsx",
  "Preview.tsx",
  "Dither.tsx",
  "Trace.tsx",
  "Surface.tsx",
  "Showreel.tsx",
  "Synth.tsx",
  "Chord.tsx",
  "OP1.tsx",
  "TP7.tsx",
  "Pchkraft.tsx",
  "Visualizer.tsx",
  "Earth.tsx",
  "VideoPlayer.tsx",
  "PhotoBooth.tsx",
  "SourceEditor.tsx",
  "Terminal.tsx",
  "Assistant.tsx",
  "SpotifyPlayer.tsx",
  "Music.tsx",
] as const;

/** App entry files that are OS shell and are not expected to be SDK-clean. */
export const SHELL_APPS = [
  "Finder.solid.tsx",
  "AppStore.tsx",
  "IconGallery.tsx",
] as const;

/** Every bundled app entry, including those still being cleaned. */
export const BUNDLED_APPS = [
  "MacPaint.tsx",
  "Canvas.tsx",
  "Foundry.tsx",
  "Safari.tsx",
  "Maps.tsx",
  "Testing.tsx",
  "FileViewer.tsx",
  "Preview.tsx",
  "Dither.tsx",
  "Trace.tsx",
  "Surface.tsx",
  "Showreel.tsx",
  "Synth.tsx",
  "Chord.tsx",
  "OP1.tsx",
  "TP7.tsx",
  "Pchkraft.tsx",
  "Visualizer.tsx",
  "Earth.tsx",
  "VideoPlayer.tsx",
  "PhotoBooth.tsx",
  "SpotifyPlayer.tsx",
  "Music.tsx",
  "SourceEditor.tsx",
  "Terminal.tsx",
  "Assistant.tsx",
  "Finder.solid.tsx",
  "AppStore.tsx",
  "IconGallery.tsx",
] as const;

export type BundledAppEntry = (typeof BUNDLED_APPS)[number];

/** Sibling directories copied into the compile project with the entry. */
export const APP_SIBLING_DIRS: Partial<Record<BundledAppEntry, readonly string[]>> = {
  "MacPaint.tsx": ["macpaint"],
  "Canvas.tsx": ["canvas"],
  "Safari.tsx": ["safari"],
  "Maps.tsx": ["maps"],
  "Foundry.tsx": ["foundry"],
  "SpotifyPlayer.tsx": ["spotify", "sprites"],
  "Music.tsx": ["music"],
  "Finder.solid.tsx": ["finder"],
  "PhotoBooth.tsx": ["photobooth"],
  "Dither.tsx": ["photobooth", "dither"],
  "Trace.tsx": ["trace"],
  "Surface.tsx": ["surface"],
  "Showreel.tsx": ["showreel"],
  "Synth.tsx": ["synth"],
  "Chord.tsx": ["chord", "synth"],
  "OP1.tsx": ["op1", "synth"],
  "TP7.tsx": ["tp7", "synth"],
  "Pchkraft.tsx": ["pchkraft", "synth", "chord"],
  "Visualizer.tsx": ["visualizer", "showreel", "surface", "synth"],
  "Earth.tsx": ["earth", "showreel"],
  "Preview.tsx": ["preview"],
  "Terminal.tsx": ["terminal"],
};

export const APP_TITLES: Record<BundledAppEntry, string> = {
  "MacPaint.tsx": "MacPaint",
  "Canvas.tsx": "Canvas",
  "Foundry.tsx": "Foundry",
  "Safari.tsx": "Safari",
  "Maps.tsx": "Maps",
  "Testing.tsx": "Testing",
  "FileViewer.tsx": "File",
  "Preview.tsx": "Preview",
  "Dither.tsx": "Dither",
  "Trace.tsx": "Trace",
  "Surface.tsx": "Surface",
  "Showreel.tsx": "Showreel",
  "Synth.tsx": "Synthesizer",
  "Chord.tsx": "Pocket Chord",
  "OP1.tsx": "OP-1",
  "TP7.tsx": "TP-7",
  "Pchkraft.tsx": "pchkraft",
  "Visualizer.tsx": "Visualizer",
  "Earth.tsx": "Earth",
  "VideoPlayer.tsx": "Video Player",
  "PhotoBooth.tsx": "Photo Booth",
  "SpotifyPlayer.tsx": "Spotify",
  "Music.tsx": "Music",
  "SourceEditor.tsx": "Source Editor",
  "Terminal.tsx": "Terminal",
  "Assistant.tsx": "Assistant",
  "Finder.solid.tsx": "Finder",
  "AppStore.tsx": "App Store",
  "IconGallery.tsx": "Icon Gallery",
};

export function isSdkClean(entry: string): boolean {
  return (SDK_CLEAN as readonly string[]).includes(entry);
}

/** Markdown table rows for the App Developer Guide, derived from the lists. */
export function bundledAppsGuideRows(): { title: string; source: string; kind: "SDK-clean" | "Shell" }[] {
  return [
    ...SDK_CLEAN.map((source) => ({ title: APP_TITLES[source], source, kind: "SDK-clean" as const })),
    ...SHELL_APPS.map((source) => ({ title: APP_TITLES[source], source, kind: "Shell" as const })),
  ];
}
