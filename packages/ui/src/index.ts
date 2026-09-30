/**
 * `@mockintosh/ui` — 1-bit Solid canvas kit (site: ui.mockintosh.com).
 *
 * Engine: host elements + createUI + layout/draw/pointer/focus/fonts.
 * Algorithms: dither, sprites, PNG (no Solid).
 * Primitives: headless create* behavior (`./primitives`).
 * Widgets: skins over host elements (`./widgets`).
 * Host adapters: `@mockintosh/ui/web`, `@mockintosh/ui/vite`.
 */

// -------------------------------------------------------------------------
// Engine
// -------------------------------------------------------------------------
export { createUI } from "./ui";
export type { UIInstance, UIConfig } from "./ui";
export { useUIServices } from "./services";
export type { UIServices, UIClipboard, UIImageService, ImageDecodeOptions } from "./services";
export { useTheme, useRadius, themeRadius, RADIUS_SCALES, RADIUS_PX, DEFAULT_THEME } from "./theme";
export type { UITheme, RadiusScale, RadiusStep } from "./theme";
export { useViewport } from "./viewport";
export type { ViewportSize } from "./viewport";

export type {
  LayoutStyle,
  LayoutRect,
  PatternName,
  PatternBits,
  Fill,
  DitherGradientFill,
  DitherGradientInit,
  GradientDirection,
  GradientKeyword,
  GradientKind,
  GradientAt,
  Ink,
  BoxProps,
  LayoutSize,
  LayoutChangeFn,
  TextProps,
  TextRun,
  TextAlign,
  TextVerticalAlign,
  ImageProps,
  RasterProps,
  BitmapProps,
  RasterPaintFn,
  RasterPaintRect,
  RasterSurface,
  CanvasNode,
  EventHandlers,
  MouseEventHandlers,
  PointerCaptureEvent,
  KeyboardEventHandlers,
  FocusEventHandlers,
  Modifiers,
  HitRect,
  HitMask,
} from "./nodes";
export { ditherGradient, isDitherGradientFill, textWraps } from "./nodes";

export {
  createPointerDispatcher,
  createDoubleClickTracker,
  hitTest,
  nodeAt,
  DOUBLE_CLICK_MS,
  DOUBLE_CLICK_DIST,
  TOUCH_SLOP,
} from "./pointer";
export type { PointerType, PointerKind, PointerExtras, PointerDispatcher, PointerScheduler } from "./pointer";
export { cursorAt, cursorOf, cssCursor, isNamedCursor, DEFAULT_CURSOR } from "./cursor";
export type { CursorName, CursorSpec, NamedCursor, CursorCSSTable } from "./cursor";
export {
  cursorFromFace,
  cursorFromFaceCached,
  faceFromCursor,
  blitQuickdrawCursor,
  blitQuickdrawCursorBits,
  blitCursorFace,
  cssCursorFromFace,
  cssCursorFromFaceCached,
  cssTableFromFaces,
  isCursorFace,
  resolveCursorFace,
  CURSOR_SIZE,
} from "./cursorFace";
export type { CursorFace, CursorFaceTable } from "./cursorFace";
export {
  cursorStampRect,
  copyBitMapBytes,
  copyBitRect,
  moveSoftwareCursor,
} from "./cursorComposite";
export { MAC_CURSOR_FACES, resolveMacCursorFace } from "./cursors/mac";
export type { MacCursorName } from "./cursors/mac";
export { encodePng1bit, encodePngRgba } from "./png";
export { collectHitRects, createDrawContext, drawTree, patternBits } from "./draw";
export { computeLayout } from "./layout";
export type { MeasureFunc } from "./layout";
export { useFocus, getFocusManager } from "./focusContext";
export { useMeasure } from "./measure";
export {
  registerFont,
  listFonts,
  listFontSizes,
  listFontFamilies,
  getFont,
  requireFont,
  fetchFont,
  defaultFontSize,
  registerOutlineFace,
  registerStyledStrike,
  unregisterFamily,
  setFamilySettings,
  familySettings,
  familyKey,
  onFontsChanged,
  fontsVersion,
  DEFAULT_FAMILY_SETTINGS,
  fontRegistrations,
  onFontRegistration,
  replayFontRegistration,
} from "./fonts/registry";
export type { FontFamilyInfo, FontRegistration, OutlineFaceRegistration } from "./fonts/registry";
export type { FamilyScalerSettings } from "./fonts/outlineStrike";
export { OutlineFace, openOutlineFace, DEFAULT_SCALER_OPTIONS } from "./fonts/truetype/scaler";
export type { ScalerOptions, StrikeMetrics, RenderedGlyph } from "./fonts/truetype/scaler";
export { bakeOutlineStrike, clampBakeSize, MIN_BAKE_SIZE, MAX_BAKE_SIZE } from "./fonts/truetype/bake";
export type { BakeOptions } from "./fonts/truetype/bake";
export { peekSfntFamily } from "./fonts/truetype/sfnt";
export {
  encodeSuitcase,
  decodeSuitcase,
  installSuitcase,
  suitcaseKey,
  outlineStyleOf,
  SUITCASE_BOLD,
  SUITCASE_ITALIC,
} from "./fonts/suitcase";
export type { FontSuitcase, SuitcaseStrike, SuitcaseOutline } from "./fonts/suitcase";
export { encodeDeckerFont, decodeDeckerFont } from "./fonts/codec";
export { deckerFontFromDraft, draftFromDeckerFont } from "./fonts/draft";
export type { FontStrikeDraft, FontStrikeGlyph } from "./fonts/draft";
export { DROM_CHARS, deckerOrdinalForCharCode, defaultRasterCharset } from "./fonts/drom";
export { getGlyphPixel, getGlyphWidth, getGlyphIndexForChar, glyphAdvance, glyphOriginX } from "./fonts/font";
export type { DeckerFont } from "./fonts/font";
export { resolveFont, fontStyleFromProps, fontFromProps, textFace } from "./fonts/style";
export type { FontStyle } from "./fonts/style";
export { measureText, fontLineHeight, drawString } from "./fonts/bridge";
export { layoutText, lineLeft, lineTop, caretPoint, indexAtPoint } from "./fonts/textLayout";
export type { TextBlock, TextLine } from "./fonts/textLayout";
export { layoutRuns, runAtPoint } from "./fonts/runLayout";
export type { RunBlock, RunLine, RunFragment, RunFace } from "./fonts/runLayout";
export { heldModifiers } from "./modifiers";
export { fontFamilyId, fontFamilyName } from "./fonts/strike";
export { drawPixels } from "./portDraw";
export { faceMetrics, faceMetricsByName, alignmentHeight, cdefBaseline, middleCellTop } from "./fonts/metrics";
export type { FontFaceMetrics, FontInfo } from "./fonts/metrics";
export { COMMAND_KEY, CHECK_MARK, BULLET } from "./fonts/extraGlyphs";
export { textSelectionOf, selectedPlainText } from "./selectable";
export type { TextSelection } from "./selectable";
export { inspectTree, type InspectionNode, type SemanticMetadata } from "./inspection";
export {
  debugInspectTree,
  findDebugNode,
  formatDebugJsx,
  debugComponent,
  type DebugNode,
} from "./debugInspect";
export type { JSX, HostProps } from "./jsx-runtime";

// -------------------------------------------------------------------------
// Algorithms
// -------------------------------------------------------------------------
export { BLACK, WHITE, defineSprite, encodeSprite, fromGrid, smallIcon } from "./sprite";
export type { Sprite } from "./sprite";
export { toBits, createDitherer, coverFrame, rasterizeFrame, isImageFrame, isDitheredAsset } from "./dither";
export { paintDitherDissolve, bayerThreshold } from "./ditherDissolve";
export { rasterizeDitherGradient, gradientT, fillGradientT, gradientDegrees, gradientAt } from "./ditherGradient";
export type { ImageFrame, DitherMode, DitherOptions, CoverFrameOptions, DitheredAsset } from "./dither";
export {
  ASCII_TILE,
  ASCII_MATCH_MODES,
  ASCII_PUNCH_MIN,
  ASCII_PUNCH_MAX,
  ASCII_PUNCH_DEFAULT,
  ASCII_DIRECTIONAL_DEFAULT,
  ASCII_NORMALIZE_DEFAULT,
  ASCII_DIFFUSE_DEFAULT,
  BASELINE_ASCII,
  resolveAsciiOptions,
  isBaselineAscii,
  asciiOptionsRevision,
  asciiToBits,
  createAsciiDitherer,
  listAsciiGlyphs,
  renderAsciiGlyphAtlas,
} from "./asciiDither";
export type { AsciiMatchMode, AsciiDitherOptions, ResolvedAsciiOptions } from "./asciiDither";
export { decodeBase64 } from "./base64";

// -------------------------------------------------------------------------
// Primitives (headless behavior)
// -------------------------------------------------------------------------
export {
  createPress,
  createToggle,
  createSlider,
  DEFAULT_SLIDER_WIDTH,
} from "./primitives";
export type {
  Press,
  PressProps,
  PressRootProps,
  ToggleBehavior,
  ToggleBehaviorProps,
  ToggleRole,
  ToggleRootProps,
  SliderBehavior,
  SliderBehaviorProps,
  SliderMetrics,
  SliderRootProps,
} from "./primitives";

// -------------------------------------------------------------------------
// Widgets
// -------------------------------------------------------------------------
export {
  Accordion,
  Attachment,
  Avatar,
  Badge,
  Breadcrumb,
  Bubble,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Disclosure,
  Dithered,
  DitherTransition,
  Empty,
  Field,
  InputGroup,
  Item,
  Kbd,
  Label,
  Marker,
  Menu,
  Message,
  MessageScroller,
  Note,
  Overlay,
  Pagination,
  Popover,
  Progress,
  Questionnaire,
  Radio,
  RadioGroup,
  Select,
  Slider,
  Spinner,
  Switch,
  Table,
  Tabs,
  TextInput,
  TextEditor,
  EditableText,
  Toggle,
  ToggleGroup,
  Tooltip,
  Divider,
  Spacer,
  ScrollView,
} from "./widgets";
export type {
  AccordionProps,
  AccordionEntry,
  AttachmentProps,
  AttachmentState,
  AvatarProps,
  BadgeProps,
  BreadcrumbProps,
  BreadcrumbItem,
  BubbleProps,
  ButtonProps,
  ButtonGroupProps,
  CardProps,
  CheckboxProps,
  DialogProps,
  DisclosureProps,
  DitheredProps,
  DitheredSrc,
  DitherTransitionProps,
  EmptyProps,
  FieldProps,
  InputGroupProps,
  ItemProps,
  KbdProps,
  LabelProps,
  MarkerProps,
  MenuProps,
  MenuItem,
  MessageProps,
  MessageScrollerProps,
  NoteProps,
  OverlayProps,
  OverlaySide,
  OverlayAlign,
  NoteVariant,
  PaginationProps,
  PopoverProps,
  ProgressProps,
  QuestionnaireProps,
  QuestionnaireStep,
  QuestionnaireChoice,
  RadioProps,
  RadioGroupProps,
  RadioOption,
  SelectProps,
  SelectOption,
  SliderProps,
  SpinnerProps,
  SwitchProps,
  TableProps,
  TabsProps,
  TabItem,
  TextInputProps,
  TextEditorProps,
  EditableTextProps,
  ToggleProps,
  ToggleGroupProps,
  ToggleOption,
  TooltipProps,
  ScrollViewProps,
} from "./widgets";

// -------------------------------------------------------------------------
// Solid re-exports
// -------------------------------------------------------------------------
export {
  createSignal,
  createEffect,
  createMemo,
  createContext,
  useContext,
  onCleanup,
  onSettled,
  flush,
  runWithOwner,
  createStore,
  reconcile,
  snapshot,
  storePath,
  merge,
  omit,
  Loading,
  Errored,
  isPending,
  latest,
  refresh,
  action,
  createOptimistic,
  createOptimisticStore,
} from "solid-js";
export { Show } from "./show";
export type { ShowProps } from "./show";
export { For, Match } from "solid-js";
/** Solid control-flow `Switch` is `import { Switch } from "solid-js"`. The kit `Switch` is the on/off widget. */
