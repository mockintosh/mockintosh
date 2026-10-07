import type { JSX } from "@mockintosh/ui";
import { decodeBase64, type RasterSurface } from "@mockintosh/ui";
import {
  Button,
  Checkbox,
  Errored,
  Loading,
  createEffect,
  createMemo,
  createSignal,
  toBits,
  useApp,
  ASCII_DIFFUSE_DEFAULT,
  ASCII_DIRECTIONAL_DEFAULT,
  ASCII_MATCH_MODES,
  ASCII_NORMALIZE_DEFAULT,
  ASCII_PUNCH_DEFAULT,
  asciiOptionsRevision,
  asciiToBits,
  type AsciiMatchMode,
  type ImageFrame,
} from "@mockintosh/sdk";
import { AdjustSlider } from "./AdjustSlider";
import { applyContrast, CONTRAST_DEFAULT, CONTRAST_MAX, CONTRAST_MIN } from "./adjust";
import { AsciiControls } from "./AsciiControls";
import {
  CROP_PAN_DEFAULT,
  CROP_PAN_MAX,
  CROP_PAN_MIN,
  CROP_SCALE_DEFAULT,
  CROP_SCALE_MAX,
  CROP_SCALE_MIN,
  IDENTITY_CROP,
  clampCrop,
  isIdentityCrop,
  sampledFrame,
} from "./crop";
import { FSTARK_EXPECTED_PNG, FSTARK_ORIGINAL_PNG } from "./fstarkFace";

/** fstark reference pair output stays 200×200 so tiles land on 8×8. */
export const COMPARE_SIZE = 200;
export const COMPARE_WINDOW = { width: 428, height: 348 } as const;

function paintBits(surface: RasterSurface, bits: Uint8Array): void {
  surface.fill(0);
  surface.blitPixels(bits, COMPARE_SIZE, COMPARE_SIZE, 0, 0);
}

function xorBits(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] === b[i] ? 0 : 1;
  return out;
}

function countDiff(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

interface CompareFrames {
  src: ImageFrame;
  expected: Uint8Array;
}

function prepareSource(src: ImageFrame, contrast: number, scale: number, panX: number, panY: number): ImageFrame {
  const crop = { scale, panX, panY };
  const sized =
    isIdentityCrop(crop) && src.width === COMPARE_SIZE && src.height === COMPARE_SIZE
      ? src
      : sampledFrame(src, COMPARE_SIZE, crop);
  return contrast === CONTRAST_DEFAULT ? sized : applyContrast(sized, contrast);
}

async function loadReference(images: NonNullable<ReturnType<typeof useApp>["images"]>): Promise<CompareFrames> {
  const src = await images.decode(decodeBase64(FSTARK_ORIGINAL_PNG), "image/png");
  const exp = await images.decode(decodeBase64(FSTARK_EXPECTED_PNG), "image/png");
  if (src.width < 1 || src.height < 1) {
    throw new Error("Original decoded empty.");
  }
  if (exp.width !== COMPARE_SIZE || exp.height !== COMPARE_SIZE) {
    throw new Error(`Expected decoded as ${exp.width}×${exp.height}, need ${COMPARE_SIZE}×${COMPARE_SIZE}.`);
  }
  return { src, expected: toBits(exp, "threshold") };
}

/**
 * Side-by-side: our ASCII dither of the original photo vs the fstark 200×200
 * result. File → Compare Reference in Photo Booth.
 */
export function AsciiCompare(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  createEffect(() => true, () => {
    app.setMenus([
      { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
    ]);
  });
  const win = app.window;
  const [showDiff, setShowDiff] = createSignal(false);
  const [contrast, setContrast] = createSignal(CONTRAST_DEFAULT);
  const [match, setMatch] = createSignal<AsciiMatchMode>("blend");
  const [punch, setPunch] = createSignal(ASCII_PUNCH_DEFAULT);
  const [directional, setDirectional] = createSignal(ASCII_DIRECTIONAL_DEFAULT);
  const [normalize, setNormalize] = createSignal(ASCII_NORMALIZE_DEFAULT);
  const [diffuse, setDiffuse] = createSignal(ASCII_DIFFUSE_DEFAULT);
  const [scale, setScale] = createSignal(CROP_SCALE_DEFAULT);
  const [panX, setPanX] = createSignal(CROP_PAN_DEFAULT);
  const [panY, setPanY] = createSignal(CROP_PAN_DEFAULT);

  let drag: { lx: number; ly: number; panX: number; panY: number } | null = null;

  const frames = createMemo(async () => {
    if (!app.images) throw new Error("This Macintosh cannot decode images.");
    return loadReference(app.images);
  });

  const total = COMPARE_SIZE * COMPARE_SIZE;
  const status = (n: number) => {
    if (n === 0) return "Match — every pixel agrees.";
    const pct = ((n / total) * 100).toFixed(1);
    return `${n} of ${total} pixels differ (${pct}%)`;
  };

  function resetCrop(): void {
    setScale(IDENTITY_CROP.scale);
    setPanX(IDENTITY_CROP.panX);
    setPanY(IDENTITY_CROP.panY);
  }

  function beginPan(lx: number, ly: number): void {
    drag = { lx, ly, panX: panX(), panY: panY() };
  }

  function movePan(lx: number, ly: number): void {
    if (!drag) return;
    const next = clampCrop({
      scale: scale(),
      panX: drag.panX + (lx - drag.lx),
      panY: drag.panY + (ly - drag.ly),
    });
    setPanX(next.panX);
    setPanY(next.panY);
  }

  return (
    <box
      width={win.width()}
      height={win.height()}
      padding={6}
      flexDirection="column"
      gap={4}
      background={0}
    >
      <Loading
        fallback={
          <box flexGrow={1} justifyContent="center" alignItems="center">
            <text font="menu" spacing={1}>Decoding…</text>
          </box>
        }
      >
        <Errored
          fallback={(err) => (
            <box flexGrow={1} justifyContent="center" alignItems="center">
              <text font="menu" spacing={1}>{err instanceof Error ? err.message : String(err)}</text>
            </box>
          )}
        >
          {(() => {
            const loaded = frames();
            const src = prepareSource(loaded.src, contrast(), scale(), panX(), panY());
            const ascii = {
              match: match(),
              punch: punch(),
              directional: directional(),
              normalize: normalize(),
              diffuse: diffuse(),
            };
            const ours = asciiToBits(src, ascii);
            const diff = countDiff(ours, loaded.expected);
            const revision =
              Math.round(contrast() * 20) +
              asciiOptionsRevision(ascii) +
              Math.round(scale() * 50) * 1000 +
              (panX() + 50) * 80_000 +
              (panY() + 50) * 8_000_000;
            return (
              <>
                <box flexDirection="row" gap={8}>
                  <box flexDirection="column" gap={4}>
                    <text font="menu" spacing={1}>Ours</text>
                    <box
                      width={COMPARE_SIZE}
                      height={COMPARE_SIZE}
                      onMouseDown={beginPan}
                      onDrag={movePan}
                      onDragEnd={() => {
                        drag = null;
                      }}
                    >
                      <raster
                        width={COMPARE_SIZE}
                        height={COMPARE_SIZE}
                        revision={revision}
                        onPaint={(surface) => paintBits(surface, ours)}
                      />
                    </box>
                  </box>
                  <box flexDirection="column" gap={4}>
                    <text font="menu" spacing={1}>{showDiff() ? "Diff" : "Expected"}</text>
                    <raster
                      width={COMPARE_SIZE}
                      height={COMPARE_SIZE}
                      revision={showDiff() ? revision + 1 : 0}
                      onPaint={(surface) => paintBits(surface, showDiff() ? xorBits(ours, loaded.expected) : loaded.expected)}
                    />
                  </box>
                </box>
                <box flexDirection="row" gap={8} alignItems="center">
                  <AdjustSlider
                    name="contrast"
                    label="Contrast"
                    value={contrast()}
                    min={CONTRAST_MIN}
                    max={CONTRAST_MAX}
                    labelWidth={52}
                    trackWidth={120}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={setContrast}
                  />
                  <Button
                    label={match() === "luma" ? "Luma" : match() === "blend" ? "Blend" : "Mass"}
                    onClick={() => {
                      const i = ASCII_MATCH_MODES.indexOf(match());
                      setMatch(ASCII_MATCH_MODES[(i + 1) % ASCII_MATCH_MODES.length]);
                    }}
                  />
                  <Button
                    label="Reset"
                    disabled={isIdentityCrop({ scale: scale(), panX: panX(), panY: panY() })}
                    onClick={resetCrop}
                  />
                </box>
                <AsciiControls
                  punch={punch()}
                  directional={directional()}
                  normalize={normalize()}
                  diffuse={diffuse()}
                  trackWidth={168}
                  labelWidth={52}
                  onPunch={setPunch}
                  onDirectional={setDirectional}
                  onNormalize={setNormalize}
                  onDiffuse={setDiffuse}
                />
                <box flexDirection="row" gap={6} alignItems="center">
                  <AdjustSlider
                    name="scale"
                    label="Scale"
                    value={scale()}
                    min={CROP_SCALE_MIN}
                    max={CROP_SCALE_MAX}
                    step={0.02}
                    labelWidth={52}
                    trackWidth={72}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={setScale}
                  />
                  <AdjustSlider
                    name="pan-x"
                    label="X"
                    value={panX()}
                    min={CROP_PAN_MIN}
                    max={CROP_PAN_MAX}
                    step={1}
                    labelWidth={10}
                    trackWidth={56}
                    format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}`}
                    onChange={setPanX}
                  />
                  <AdjustSlider
                    name="pan-y"
                    label="Y"
                    value={panY()}
                    min={CROP_PAN_MIN}
                    max={CROP_PAN_MAX}
                    step={1}
                    labelWidth={10}
                    trackWidth={56}
                    format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}`}
                    onChange={setPanY}
                  />
                </box>
                <box flexDirection="row" gap={8} alignItems="center">
                  <Checkbox
                    name="show-diff"
                    label="Show Diff"
                    checked={showDiff()}
                    onChange={setShowDiff}
                  />
                  <text font="body">{status(diff)}</text>
                </box>
              </>
            );
          })()}
        </Errored>
      </Loading>
    </box>
  );
}
