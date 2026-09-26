/**
 * The bundled-app manifest: which entries compile as user projects (SDK-clean)
 * and which are part of the shell. `sdkClean.test.ts` and the App Developer
 * Guide table both read this file so the three stay in lockstep.
 */

/** App entry files under `apps/` that must compile through the in-OS builder. */
export const SDK_CLEAN = [
  "MacPaint.tsx",
  "Canvas.tsx",
  "Safari.tsx",
  "Testing.tsx",
  "FileViewer.tsx",
  "Preview.tsx",
  "Dither.tsx",
  "Trace.tsx",
  "Surface.tsx",
  "Showreel.tsx",
  "VideoPlayer.tsx",
  "PhotoBooth.tsx",
  "SourceEditor.tsx",
  "Terminal.tsx",
  "ChatGippity.tsx",
  "SpotifyPlayer.tsx",
  "GitHub.tsx",
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
  "Safari.tsx",
  "Testing.tsx",
  "FileViewer.tsx",
  "Preview.tsx",
  "Dither.tsx",
  "Trace.tsx",
  "Surface.tsx",
  "Showreel.tsx",
  "VideoPlayer.tsx",
  "PhotoBooth.tsx",
  "SpotifyPlayer.tsx",
  "SourceEditor.tsx",
  "Terminal.tsx",
  "ChatGippity.tsx",
  "GitHub.tsx",
  "Finder.solid.tsx",
  "AppStore.tsx",
  "IconGallery.tsx",
] as const;

export type BundledAppEntry = (typeof BUNDLED_APPS)[number];

/** Sibling directories copied into the compile project with the entry. */
export const APP_SIBLING_DIRS: Partial<Record<BundledAppEntry, readonly string[]>> = {
  "MacPaint.tsx": ["macpaint"],
  "Canvas.tsx": ["canvas"],
  "SpotifyPlayer.tsx": ["spotify", "sprites"],
  "Finder.solid.tsx": ["finder"],
  "PhotoBooth.tsx": ["photobooth"],
  "Dither.tsx": ["photobooth", "dither"],
  "Trace.tsx": ["trace"],
  "Surface.tsx": ["surface"],
  "Showreel.tsx": ["showreel"],
  "GitHub.tsx": ["github"],
};

export const APP_TITLES: Record<BundledAppEntry, string> = {
  "MacPaint.tsx": "MacPaint",
  "Canvas.tsx": "Canvas",
  "Safari.tsx": "Safari",
  "Testing.tsx": "Testing",
  "FileViewer.tsx": "File",
  "Preview.tsx": "Preview",
  "Dither.tsx": "Dither",
  "Trace.tsx": "Trace",
  "Surface.tsx": "Surface",
  "Showreel.tsx": "Showreel",
  "VideoPlayer.tsx": "Video Player",
  "PhotoBooth.tsx": "Photo Booth",
  "SpotifyPlayer.tsx": "Spotify",
  "GitHub.tsx": "GitHub",
  "SourceEditor.tsx": "Source Editor",
  "Terminal.tsx": "Terminal",
  "ChatGippity.tsx": "ChatGippity",
  "Finder.solid.tsx": "Finder",
  "AppStore.tsx": "App Store",
  "IconGallery.tsx": "Icon Gallery",
};

export function isSdkClean(entry: string): boolean {
  return (SDK_CLEAN as readonly string[]).includes(entry);
}

export function isShellApp(entry: string): boolean {
  return (SHELL_APPS as readonly string[]).includes(entry);
}

/** Markdown table rows for the App Developer Guide, derived from the lists. */
export function bundledAppsGuideRows(): { title: string; source: string; kind: "SDK-clean" | "Shell" }[] {
  return [
    ...SDK_CLEAN.map((source) => ({ title: APP_TITLES[source], source, kind: "SDK-clean" as const })),
    ...SHELL_APPS.map((source) => ({ title: APP_TITLES[source], source, kind: "Shell" as const })),
  ];
}
