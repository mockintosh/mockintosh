import type { ImageFrame } from "@mockintosh/ui";

/**
 * A graphics processor that runs pixel programs: a Shadertoy-shaped picture
 * in, an `ImageFrame` out. The picture is colour; it becomes 1-bit at the
 * same boundary camera frames do (`createDitherer`), never on the GPU's side.
 * It also rasterizes meshes with a depth test (`rasterizer`), for an app
 * that keeps a scene there.
 *
 * A program is WGSL that defines
 *
 * ```wgsl
 * fn mainImage(fragCoord: vec2f) -> vec4f
 * ```
 *
 * `fragCoord` is the pixel centre in pixels, origin top left, y down. The
 * program can read these inputs:
 *
 * - `u.resolution: vec2f` — the picture size in pixels
 * - `u.time: f32` — seconds, as given to `render`
 * - `u.frame: f32` — how many times this program has rendered
 * - `u.mouse: vec4f` — as given to `render`
 * - `u.params: array<vec4f, 4>` — up to 16 numbers of the app's own
 */
export interface GpuService {
  /** Compile a program. Rejects with the compiler's messages when it doesn't compile. */
  compile(source: string): Promise<GpuProgram>;
  /** What the hardware calls itself, e.g. "apple metal-3"; empty when the host won't say. */
  describe(): Promise<string>;
  /** A rasterizer for meshes kept on the GPU (`GpuRasterizer`). */
  rasterizer(): Promise<GpuRasterizer>;
}

export interface GpuRenderRequest {
  width: number;
  height: number;
  time: number;
  mouse?: readonly [number, number, number, number];
  /** Up to 16 numbers, read in the program as `u.params[i / 4][i % 4]`. */
  params?: readonly number[];
  /** Samples per pixel along each axis (1–4), averaged: anti-aliasing for the dither. Default 1. */
  samples?: number;
}

export interface GpuProgram {
  /** Run the program once for every pixel. Several renders may be in flight at once. */
  render(request: GpuRenderRequest): Promise<ImageFrame>;
  close(): void;
}

/**
 * Draws meshes kept on the graphics processor into a picture of one byte a
 * pixel, the nearest primitive showing at each: for an app that keeps its
 * scene on the GPU and moves only a camera from frame to frame. What a
 * value looks like, and turning the picture into ink, is the app's to say.
 *
 * A corner program is WGSL that defines
 *
 * ```wgsl
 * fn corner(at: array<vec4f, N>) -> RasterCorner
 * ```
 *
 * where `N` is the mesh's numbers a corner over 4, and returns
 * `RasterCorner(position, value)`: `position` in clip space, as WebGPU
 * takes it (x and y from -1 to 1, y up; z from 0 to w, a bigger z / w
 * nearer), and `value` (1–255) for the primitive's pixels, taken from its
 * first corner. A primitive whose corners are all put behind (z < 0) is
 * left out. The program can read:
 *
 * - `frame.size: vec2f` — the picture size in pixels
 * - `frame.params: array<vec4f, 16>` — up to 64 numbers for the whole draw
 * - `batch.params: array<vec4f, 4>` — up to 16 numbers for the batch
 * - `meshData: array<vec4f>` — the batch's mesh's data, as given to `mesh`
 */
export interface GpuRasterizer {
  /** Compile a corner program for meshes of `numbersPerCorner` (a multiple of 4) numbers a corner. Rejects with the compiler's messages. */
  program(source: string, numbersPerCorner: number): Promise<GpuCornerProgram>;
  /** Corners, and data the program can read, kept on the GPU until closed. */
  mesh(corners: Float32Array, data?: Float32Array): GpuMesh;
  /** One byte a pixel, row by row, `width × height` long, 0 where nothing was drawn. Several draws may be in flight at once. */
  draw(request: GpuRasterRequest): Promise<Uint8Array>;
  close(): void;
}

export interface GpuRasterRequest {
  width: number;
  height: number;
  /** Up to 64 numbers, read in the program as `frame.params[i / 4][i % 4]`. */
  params?: readonly number[];
  /** Drawn in order; where two are as near, the one drawn first shows. */
  batches: readonly GpuRasterBatch[];
}

export interface GpuRasterBatch {
  program: GpuCornerProgram;
  mesh: GpuMesh;
  /** Each three corners a triangle, or each two a line one pixel wide. */
  topology: "triangles" | "lines";
  /** The corners drawn: from `first`, `count` of them; by default all. */
  first?: number;
  count?: number;
  /** Up to 16 numbers, read in the program as `batch.params[i / 4][i % 4]`. */
  params?: readonly number[];
}

export interface GpuCornerProgram {
  close(): void;
}

export interface GpuMesh {
  close(): void;
}
