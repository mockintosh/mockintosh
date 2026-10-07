/**
 * `GpuService` on WebGPU. A program's `mainImage` runs in a compute shader,
 * one invocation per pixel, `samples²` times each; the averaged colour is
 * packed into a storage buffer and read back as an `ImageFrame`. No canvas is
 * involved, so this works the same on the page and in an app's worker.
 *
 * The rasterizer keeps meshes in vertex and storage buffers, draws them with
 * the app's corner program into an `r8uint` texture with a depth buffer,
 * and reads that back the same way.
 */
import type { GpuCornerProgram, GpuMesh, GpuProgram, GpuRasterRequest, GpuRasterizer, GpuRenderRequest, GpuService, ImageFrame } from "@mockintosh/sdk";

// The few WebGPU shapes used here; TypeScript's DOM lib doesn't carry them yet.
type GPUDevice = any;
type GPUBuffer = any;
interface GPULike {
  requestAdapter(options?: { powerPreference?: "high-performance" | "low-power" }): Promise<any>;
}

const BUFFER_USAGE = { MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, VERTEX: 0x0020, UNIFORM: 0x0040, STORAGE: 0x0080 };
const TEXTURE_USAGE = { COPY_SRC: 0x01, RENDER_ATTACHMENT: 0x10 };
const MAP_MODE_READ = 0x0001;
const STORAGE = BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC;
const READBACK = BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST;

/** `Inputs` as WGSL lays it out: 112 bytes. */
const INPUT_FLOATS = 28;

const PREAMBLE = `struct Inputs {
  resolution: vec2f,
  time: f32,
  frame: f32,
  mouse: vec4f,
  params: array<vec4f, 4>,
  samples: u32,
};
@group(0) @binding(0) var<uniform> u: Inputs;
@group(0) @binding(1) var<storage, read_write> mockintoshPixels: array<u32>;
`;

const MAIN = `
@compute @workgroup_size(8, 8)
fn mockintoshMain(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2u(u.resolution);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let n = max(u.samples, 1u);
  var sum = vec4f(0.0);
  for (var j = 0u; j < n; j++) {
    for (var i = 0u; i < n; i++) {
      sum += mainImage(vec2f(id.xy) + (vec2f(f32(i), f32(j)) + 0.5) / f32(n));
    }
  }
  mockintoshPixels[id.y * size.x + id.x] = pack4x8unorm(clamp(sum / f32(n * n), vec4f(0.0), vec4f(1.0)));
}
`;

const PREAMBLE_LINES = PREAMBLE.split("\n").length - 1;

function gpuOf(): GPULike | undefined {
  return (globalThis.navigator as { gpu?: GPULike } | undefined)?.gpu;
}

/** The web's GPU service, or `undefined` when this browser has no WebGPU. */
export function createWebGpuService(): GpuService | undefined {
  const gpu = gpuOf();
  if (!gpu) return undefined;

  let adapter: Promise<any> | null = null;
  let device: Promise<GPUDevice> | null = null;

  function getAdapter(): Promise<any> {
    adapter ??= gpu!.requestAdapter({ powerPreference: "high-performance" }).then((found) => {
      if (!found) throw new Error("This Macintosh's graphics processor isn't available.");
      return found;
    });
    return adapter;
  }

  function getDevice(): Promise<GPUDevice> {
    device ??= getAdapter()
      .then((found) => found.requestDevice())
      .then((opened: GPUDevice) => {
        void opened.lost.then(() => {
          adapter = null;
          device = null;
        });
        return opened;
      });
    device.catch(() => {
      adapter = null;
      device = null;
    });
    return device;
  }

  return {
    async describe() {
      const info = (await getAdapter()).info as { vendor?: string; architecture?: string; description?: string } | undefined;
      return [info?.vendor, info?.architecture].filter(Boolean).join(" ") || info?.description || "";
    },
    async rasterizer() {
      return createRasterizer(await getDevice());
    },
    async compile(source) {
      const gpuDevice = await getDevice();
      const module = gpuDevice.createShaderModule({ code: PREAMBLE + source + MAIN });
      const info = await module.getCompilationInfo();
      const errors = (info.messages as { type: string; lineNum: number; message: string }[]).filter((m) => m.type === "error");
      if (errors.length) {
        throw new Error(errors.map((m) => `line ${m.lineNum - PREAMBLE_LINES}: ${m.message}`).join("\n"));
      }
      gpuDevice.pushErrorScope("validation");
      const pipeline = await gpuDevice.createComputePipelineAsync({
        layout: "auto",
        compute: { module, entryPoint: "mockintoshMain" },
      });
      const failure = await gpuDevice.popErrorScope();
      if (failure) throw new Error(failure.message);
      return createProgram(gpuDevice, pipeline);
    },
  };
}

function createProgram(device: GPUDevice, pipeline: any): GpuProgram {
  /** Idle output buffers by usage and byte size; a render takes one and gives it back. */
  const spare = new Map<string, GPUBuffer[]>();
  let frame = 0;
  let closed = false;

  function take(size: number, usage: number): GPUBuffer {
    return spare.get(`${usage}:${size}`)?.pop() ?? device.createBuffer({ size, usage });
  }

  function give(size: number, usage: number, buffer: GPUBuffer): void {
    if (closed) return buffer.destroy();
    const key = `${usage}:${size}`;
    const list = spare.get(key) ?? [];
    // Keep a few per size: enough to pipeline, not a leak when a window resizes.
    if (list.length < 3) list.push(buffer);
    else buffer.destroy();
    spare.set(key, list);
  }

  return {
    async render(request: GpuRenderRequest): Promise<ImageFrame> {
      if (closed) throw new Error("This program is closed.");
      const width = Math.max(1, Math.floor(request.width));
      const height = Math.max(1, Math.floor(request.height));
      const bytes = width * height * 4;

      const inputs = new ArrayBuffer(INPUT_FLOATS * 4);
      const floats = new Float32Array(inputs);
      floats.set([width, height, request.time, frame++]);
      floats.set(request.mouse ?? [0, 0, 0, 0], 4);
      floats.set((request.params ?? []).slice(0, 16), 8);
      new Uint32Array(inputs)[24] = Math.min(4, Math.max(1, Math.round(request.samples ?? 1)));

      const uniform = device.createBuffer({ size: inputs.byteLength, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
      device.queue.writeBuffer(uniform, 0, inputs);
      const storage = take(bytes, STORAGE);
      const readback = take(bytes, READBACK);

      const bindings = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: storage } },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindings);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      encoder.copyBufferToBuffer(storage, 0, readback, 0, bytes);
      device.queue.submit([encoder.finish()]);

      try {
        await readback.mapAsync(MAP_MODE_READ);
        const rgba = new Uint8ClampedArray(bytes);
        rgba.set(new Uint8Array(readback.getMappedRange()));
        readback.unmap();
        return { width, height, rgba };
      } finally {
        uniform.destroy();
        give(bytes, STORAGE, storage);
        give(bytes, READBACK, readback);
      }
    },
    close() {
      closed = true;
      for (const list of spare.values()) for (const buffer of list) buffer.destroy();
      spare.clear();
    },
  };
}

/** What a corner program can read, before its source. */
const RASTER_PREAMBLE = `struct MockintoshFrame {
  size: vec2f,
  unused: vec2f,
  params: array<vec4f, 16>,
};
@group(0) @binding(0) var<uniform> frame: MockintoshFrame;
struct MockintoshBatch { params: array<vec4f, 4> };
@group(0) @binding(1) var<uniform> batch: MockintoshBatch;
@group(0) @binding(2) var<storage, read> meshData: array<vec4f>;
struct RasterCorner {
  position: vec4f,
  value: u32,
};
`;

const RASTER_PREAMBLE_LINES = RASTER_PREAMBLE.split("\n").length - 1;

/** The corner program's entry points, for corners of `vectors` vec4s: each pixel gets its primitive's value, unblended. */
function rasterMain(vectors: number): string {
  const inputs = Array.from({ length: vectors }, (_, k) => `@location(${k}) a${k}: vec4f`).join(", ");
  const args = Array.from({ length: vectors }, (_, k) => `a${k}`).join(", ");
  return `
struct MockintoshCorner {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) value: u32,
};
@vertex fn mockintoshCorner(${inputs}) -> MockintoshCorner {
  let c = corner(array<vec4f, ${vectors}>(${args}));
  return MockintoshCorner(c.position, c.value);
}
@fragment fn mockintoshPixel(@location(0) @interpolate(flat) value: u32) -> @location(0) vec4u {
  return vec4u(value, 0u, 0u, 0u);
}
`;
}

/** Bytes of `MockintoshFrame` and `MockintoshBatch`. */
const FRAME_BYTES = 16 + 64 * 4;
const BATCH_BYTES = 16 * 4;
const SHADER_VERTEX = 0x1;

interface CornerProgram extends GpuCornerProgram {
  readonly triangles: any;
  readonly lines: any;
  readonly vectors: number;
}

interface Mesh extends GpuMesh {
  readonly corners: GPUBuffer;
  readonly data: GPUBuffer;
  readonly count: number;
}

function createRasterizer(device: GPUDevice): GpuRasterizer {
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: SHADER_VERTEX, buffer: { type: "uniform" } },
      { binding: 1, visibility: SHADER_VERTEX, buffer: { type: "uniform" } },
      { binding: 2, visibility: SHADER_VERTEX, buffer: { type: "read-only-storage" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  /** The last size's targets, kept while the size stays: an app's frames are mostly one size. */
  let targets: { width: number; height: number; colour: any; depth: any } | null = null;
  let closed = false;

  function targetsFor(width: number, height: number) {
    if (targets && targets.width === width && targets.height === height) return targets;
    targets?.colour.destroy();
    targets?.depth.destroy();
    const size = { width, height };
    targets = {
      width,
      height,
      colour: device.createTexture({ size, format: "r8uint", usage: TEXTURE_USAGE.RENDER_ATTACHMENT | TEXTURE_USAGE.COPY_SRC }),
      depth: device.createTexture({ size, format: "depth32float", usage: TEXTURE_USAGE.RENDER_ATTACHMENT }),
    };
    return targets;
  }

  /** A uniform buffer of `floats`. */
  function uniform(floats: Float32Array): GPUBuffer {
    const buffer = device.createBuffer({ size: floats.byteLength, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
    device.queue.writeBuffer(buffer, 0, floats.buffer, floats.byteOffset, floats.byteLength);
    return buffer;
  }

  return {
    async program(source, numbersPerCorner) {
      const vectors = Math.max(1, Math.ceil(numbersPerCorner / 4));
      const module = device.createShaderModule({ code: RASTER_PREAMBLE + source + rasterMain(vectors) });
      const info = await module.getCompilationInfo();
      const errors = (info.messages as { type: string; lineNum: number; message: string }[]).filter((m) => m.type === "error");
      if (errors.length) throw new Error(errors.map((m) => `line ${m.lineNum - RASTER_PREAMBLE_LINES}: ${m.message}`).join("\n"));
      const attributes = Array.from({ length: vectors }, (_, k) => ({ shaderLocation: k, offset: k * 16, format: "float32x4" }));
      const pipeline = (topology: "triangle-list" | "line-list") =>
        device.createRenderPipelineAsync({
          layout: pipelineLayout,
          vertex: { module, entryPoint: "mockintoshCorner", buffers: [{ arrayStride: vectors * 16, attributes }] },
          fragment: { module, entryPoint: "mockintoshPixel", targets: [{ format: "r8uint" }] },
          primitive: { topology, cullMode: "none" },
          // Bigger z is nearer; a tie keeps what was drawn first.
          depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
        });
      device.pushErrorScope("validation");
      const [triangles, lines] = await Promise.all([pipeline("triangle-list"), pipeline("line-list")]);
      const failure = await device.popErrorScope();
      if (failure) throw new Error(failure.message);
      const program: CornerProgram = { triangles, lines, vectors, close() {} };
      return program;
    },

    mesh(corners, data) {
      const cornerBuffer = device.createBuffer({ size: Math.max(16, corners.byteLength), usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST });
      if (corners.byteLength) device.queue.writeBuffer(cornerBuffer, 0, corners.buffer, corners.byteOffset, corners.byteLength);
      const bytes = data?.byteLength ?? 0;
      // A storage binding can't be empty.
      const dataBuffer = device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST });
      if (data && bytes) device.queue.writeBuffer(dataBuffer, 0, data.buffer, data.byteOffset, bytes);
      const mesh: Mesh = {
        corners: cornerBuffer,
        data: dataBuffer,
        count: corners.length,
        close() {
          cornerBuffer.destroy();
          dataBuffer.destroy();
        },
      };
      return mesh;
    },

    async draw(request: GpuRasterRequest): Promise<Uint8Array> {
      if (closed) throw new Error("This rasterizer is closed.");
      const width = Math.max(1, Math.floor(request.width));
      const height = Math.max(1, Math.floor(request.height));
      const { colour, depth } = targetsFor(width, height);
      // Rows of a texture copied to a buffer are padded to 256 bytes.
      const stride = Math.ceil(width / 256) * 256;
      const made: GPUBuffer[] = [];

      const frameFloats = new Float32Array(FRAME_BYTES / 4);
      frameFloats.set([width, height]);
      frameFloats.set((request.params ?? []).slice(0, 64), 4);
      const frameUniform = uniform(frameFloats);
      made.push(frameUniform);
      const readback = device.createBuffer({ size: stride * height, usage: READBACK });
      made.push(readback);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: colour.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: depth.createView(), depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "discard" },
      });
      for (const batch of request.batches) {
        const program = batch.program as CornerProgram;
        const mesh = batch.mesh as Mesh;
        const perCorner = program.vectors * 4;
        const first = batch.first ?? 0;
        const count = Math.min(batch.count ?? Infinity, mesh.count / perCorner - first);
        if (count <= 0) continue;
        const batchFloats = new Float32Array(BATCH_BYTES / 4);
        batchFloats.set((batch.params ?? []).slice(0, 16));
        const batchUniform = uniform(batchFloats);
        made.push(batchUniform);
        pass.setPipeline(batch.topology === "lines" ? program.lines : program.triangles);
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout,
            entries: [
              { binding: 0, resource: { buffer: frameUniform } },
              { binding: 1, resource: { buffer: batchUniform } },
              { binding: 2, resource: { buffer: mesh.data } },
            ],
          }),
        );
        pass.setVertexBuffer(0, mesh.corners);
        pass.draw(count, 1, first);
      }
      pass.end();
      encoder.copyTextureToBuffer({ texture: colour }, { buffer: readback, bytesPerRow: stride, rowsPerImage: height }, { width, height });
      device.queue.submit([encoder.finish()]);

      try {
        await readback.mapAsync(MAP_MODE_READ);
        const padded = new Uint8Array(readback.getMappedRange());
        const out = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) out.set(padded.subarray(y * stride, y * stride + width), y * width);
        readback.unmap();
        return out;
      } finally {
        for (const buffer of made) buffer.destroy();
      }
    },

    close() {
      closed = true;
      targets?.colour.destroy();
      targets?.depth.destroy();
      targets = null;
    },
  };
}
