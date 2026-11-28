// @vitest-environment jsdom
/**
 * T-063 — renderer-side tests.
 *
 * Pure geometry / palette cases run with no GL at all; the renderer cases use
 * a typed FakeWebGL2 stub that records every GL call, so we can assert the
 * destroy() resource list and idempotence without a real GPU.
 */
import { describe, expect, it, vi } from "vitest";
import {
  decodePickColor,
  encodePickColor,
  nodeRadius,
  packNodeInstances,
  boundsOf,
} from "../src/features/graph/gpu/geometry.ts";
import { FALLBACK_PALETTE, readPalette } from "../src/features/graph/gpu/palette.ts";
import { GpuGraphRenderer } from "../src/features/graph/gpu/renderer.ts";
import {
  LAYOUT_DEFAULTS,
  type GpuEdge,
  type GpuGraph,
  type GpuNode,
  type LayoutState,
} from "../src/features/graph/gpu/types.ts";

// --------------------------------------------------------------------- pure

describe("pick color codec", () => {
  it("round-trips boundary ids 0, 1, 65535 and 2^24 - 1", () => {
    for (const id of [0, 1, 65535, 16777215]) {
      const { r, g, b } = encodePickColor(id);
      expect(decodePickColor(r, g, b)).toBe(id);
    }
  });

  it("splits bytes little-endian: r = low byte, b = high byte", () => {
    const { r, g, b } = encodePickColor(0x010203);
    expect(r).toBe(0x03);
    expect(g).toBe(0x02);
    expect(b).toBe(0x01);
  });
});

describe("nodeRadius", () => {
  it("is monotonic non-decreasing in degree and caps at 14", () => {
    const r0 = nodeRadius(0, 1);
    const r10 = nodeRadius(10, 1);
    const r100 = nodeRadius(100, 1);
    expect(r10).toBeGreaterThanOrEqual(r0);
    expect(r100).toBeGreaterThanOrEqual(r10);
    expect(r100).toBeLessThanOrEqual(14);
  });

  it("scales linearly with nodeSize", () => {
    expect(nodeRadius(5, 2)).toBeCloseTo(nodeRadius(5, 1) * 2, 10);
  });
});

describe("packNodeInstances", () => {
  const graph: GpuGraph = {
    nodes: [
      { id: "a", label: "A", resolved: true, degree: 2 },
      { id: "b", label: "B", resolved: true, degree: 1 },
      { id: "c", label: "C", resolved: false, degree: 0 },
    ],
    edges: [
      { source: 0, target: 1, broken: false },
      { source: 0, target: 2, broken: true },
      { source: 99, target: 1, broken: false }, // out of range, dropped
    ],
  };

  it("lays out positions (2 floats) and meta (6 floats) per node", () => {
    const pack = packNodeInstances(graph);
    expect(pack.nodeCount).toBe(3);
    expect(pack.positions.length).toBe(3 * 2);
    expect(pack.meta.length).toBe(3 * 6);
  });

  it("splits normal and broken edges and drops invalid indices", () => {
    const pack = packNodeInstances(graph);
    expect(pack.normalEdges.length).toBe(2);
    expect(pack.brokenEdges.length).toBe(2);
  });

  it("stores a 1-based pick id so 0 stays the backdrop miss", () => {
    const pack = packNodeInstances(graph);
    expect(pack.meta[5]).toBe(1);
    expect(pack.meta[11]).toBe(2);
    expect(pack.meta[17]).toBe(3);
  });
});

describe("boundsOf", () => {
  it("returns the origin bounds for empty arrays", () => {
    expect(boundsOf(new Float32Array(0), new Float32Array(0))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    });
  });

  it("computes min/max over both arrays", () => {
    const b = boundsOf(new Float32Array([3, -2, 7]), new Float32Array([1, -5, 4]));
    expect(b).toEqual({ minX: -2, minY: -5, maxX: 7, maxY: 4 });
  });
});

describe("palette fallback", () => {
  it("returns the fallback set when no CSS variable is defined", () => {
    const palette = readPalette();
    expect(palette).toEqual(FALLBACK_PALETTE);
  });

  it("also falls back when handed a detached element", () => {
    const el = document.createElement("div");
    expect(readPalette(el)).toEqual(FALLBACK_PALETTE);
  });
});

// ------------------------------------------------------- fake GL renderer

const GL = {
  VERTEX_SHADER: 0x8b71,
  FRAGMENT_SHADER: 0x8b30,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  TRIANGLES: 4,
  LINES: 1,
  UNSIGNED_SHORT: 0x1403,
  UNSIGNED_INT: 0x1405,
  FLOAT: 0x1406,
  BLEND: 0x0be2,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  COLOR_BUFFER_BIT: 0x4000,
  RGBA: 0x1908,
  RGBA8: 0x8058,
  UNSIGNED_BYTE: 0x1401,
  TEXTURE_2D: 0x0de1,
  NEAREST: 0x2600,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  MAX_TEXTURE_SIZE: 0xd33,
  RENDERER: 0x1f02,
  COMPILE_STATUS: 0x8b82,
  LINK_STATUS: 0x8b82,
} as const;

class FakeGL {
  constructor() {
    Object.assign(this, GL);
  }

  readonly deleteCounts = {
    program: 0,
    buffer: 0,
    vao: 0,
    texture: 0,
    fbo: 0,
    shader: 0,
  };
  readonly drawCalls: string[] = [];
  readonly buffersCreated: string[] = [];
  linkOk = true;
  compileOk = true;
  nextRead: Uint8Array | null = null;

  private nextId = 1;
  private shaders = new Map<number, Record<string, never>>();
  private programs = new Map<number, Record<string, never>>();
  private buffers = new Map<number, Record<string, never>>();
  private vaos = new Map<number, Record<string, never>>();
  private textures = new Map<number, Record<string, never>>();
  private fbos = new Map<number, Record<string, never>>();

  getExtension(name: string): Record<string, number> | null {
    if (name === "WEBGL_debug_renderer_info") {
      return { UNMASKED_RENDERER_WEBGL: 0x9245 };
    }
    return null;
  }

  getParameter(name: number): unknown {
    if (name === GL.RENDERER || name === 0x9245) return "FakeGPU";
    if (name === GL.MAX_TEXTURE_SIZE) return 4096;
    return null;
  }

  createShader(): number {
    const id = this.nextId++;
    this.shaders.set(id, {});
    return id;
  }
  shaderSource(shader: number): void {
    void shader;
  }
  compileShader(shader: number): void {
    void shader;
  }
  getShaderParameter(shader: number, pname: number): boolean {
    void shader;
    void pname;
    return this.compileOk;
  }
  getShaderInfoLog(): string {
    return "";
  }
  deleteShader(shader: number): void {
    if (this.shaders.delete(shader)) this.deleteCounts.shader++;
  }

  createProgram(): number {
    const id = this.nextId++;
    this.programs.set(id, {});
    return id;
  }
  attachShader(program: number, shader: number): void {
    void program;
    void shader;
  }
  linkProgram(program: number): void {
    void program;
  }
  getProgramParameter(program: number, pname: number): boolean {
    void program;
    void pname;
    return this.linkOk;
  }
  getProgramInfoLog(): string {
    return "";
  }
  deleteProgram(program: number): void {
    if (this.programs.delete(program)) this.deleteCounts.program++;
  }
  getUniformLocation(program: number, name: string): Record<string, string> {
    void program;
    return { name };
  }

  createBuffer(): number {
    const id = this.nextId++;
    this.buffers.set(id, {});
    this.buffersCreated.push(`buffer:${id}`);
    return id;
  }
  bindBuffer(target: number, buffer: number | null): void {
    void target;
    void buffer;
  }
  bufferData(target: number, data: unknown, usage: number): void {
    void target;
    void data;
    void usage;
  }
  bufferSubData(target: number, offset: number, src: Float32Array, srcOffset: number, length: number): void {
    void target;
    void offset;
    void src;
    void srcOffset;
    void length;
  }
  deleteBuffer(buffer: number): void {
    if (this.buffers.delete(buffer)) this.deleteCounts.buffer++;
  }

  createVertexArray(): number {
    const id = this.nextId++;
    this.vaos.set(id, {});
    return id;
  }
  bindVertexArray(vao: number | null): void {
    void vao;
  }
  deleteVertexArray(vao: number): void {
    if (this.vaos.delete(vao)) this.deleteCounts.vao++;
  }
  enableVertexAttribArray(location: number): void {
    void location;
  }
  vertexAttribPointer(location: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void {
    void location;
    void size;
    void type;
    void normalized;
    void stride;
    void offset;
  }
  vertexAttribDivisor(location: number, divisor: number): void {
    void location;
    void divisor;
  }

  createTexture(): number {
    const id = this.nextId++;
    this.textures.set(id, {});
    return id;
  }
  bindTexture(target: number, texture: number | null): void {
    void target;
    void texture;
  }
  texImage2D(target: number, level: number, internalFormat: number, w: number, h: number, border: number, format: number, type: number, data: unknown): void {
    void target;
    void level;
    void internalFormat;
    void w;
    void h;
    void border;
    void format;
    void type;
    void data;
  }
  texParameteri(target: number, pname: number, param: number): void {
    void target;
    void pname;
    void param;
  }
  deleteTexture(texture: number): void {
    if (this.textures.delete(texture)) this.deleteCounts.texture++;
  }

  createFramebuffer(): number {
    const id = this.nextId++;
    this.fbos.set(id, {});
    return id;
  }
  bindFramebuffer(target: number, fbo: number | null): void {
    void target;
    void fbo;
  }
  framebufferTexture2D(target: number, attachment: number, texTarget: number, texture: number, level: number): void {
    void target;
    void attachment;
    void texTarget;
    void texture;
    void level;
  }
  checkFramebufferStatus(target: number): number {
    void target;
    return GL.FRAMEBUFFER_COMPLETE;
  }
  deleteFramebuffer(fbo: number): void {
    if (this.fbos.delete(fbo)) this.deleteCounts.fbo++;
  }

  viewport(w: number, h: number, d: number, e: number): void {
    void w;
    void h;
    void d;
    void e;
  }
  enable(cap: number): void {
    void cap;
  }
  blendFunc(src: number, dst: number): void {
    void src;
    void dst;
  }
  clearColor(r: number, g: number, b: number, a: number): void {
    void r;
    void g;
    void b;
    void a;
  }
  clear(mask: number): void {
    void mask;
  }
  useProgram(program: number): void {
    void program;
  }
  uniform3f(location: Record<string, string> | null, x: number, y: number, z: number): void {
    void location;
    void x;
    void y;
    void z;
  }
  uniform2f(location: Record<string, string> | null, x: number, y: number): void {
    void location;
    void x;
    void y;
  }
  uniform4f(location: Record<string, string> | null, r: number, g: number, b: number, a: number): void {
    void location;
    void r;
    void g;
    void b;
    void a;
  }
  uniform1f(location: Record<string, string> | null, x: number): void {
    void location;
    void x;
  }
  drawElementsInstanced(mode: number, count: number, type: number, offset: number, instances: number): void {
    void count;
    void type;
    void offset;
    this.drawCalls.push(`instanced:${mode}:${instances}`);
  }
  drawElementsInstancedBaseInstance(
    mode: number,
    count: number,
    type: number,
    offset: number,
    instances: number,
    baseInstance: number,
  ): void {
    void count;
    void type;
    void offset;
    this.drawCalls.push(`instanced-base:${mode}:${instances}:${baseInstance}`);
  }
  drawElements(mode: number, count: number, type: number, offset: number): void {
    void count;
    void type;
    void offset;
    this.drawCalls.push(`elements:${mode}`);
  }
  readPixels(x: number, y: number, w: number, h: number, format: number, type: number, pixels: Uint8Array): void {
    void x;
    void y;
    void w;
    void h;
    void format;
    void type;
    if (this.nextRead) pixels.set(this.nextRead);
  }
}

function makeCanvasWith(fake: FakeGL): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(
    fake as unknown as WebGL2RenderingContext,
  );
  return canvas;
}

function makeLayout(count: number): LayoutState {
  return {
    count,
    x: new Float32Array(count).map((_, i) => i),
    y: new Float32Array(count).map((_, i) => -i),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    options: LAYOUT_DEFAULTS,
    alpha: () => 0.5,
    settled: () => false,
    step: () => undefined,
    stepUntil: () => undefined,
    bounds: () => ({ minX: 0, minY: 0, maxX: 1, maxY: 1 }),
    fingerprint: () => "test",
  };
}

const fixtureNodes: GpuNode[] = [
  { id: "a", label: "A", resolved: true, degree: 3 },
  { id: "b", label: "B", resolved: true, degree: 1 },
  { id: "c", label: "C", resolved: false, degree: 0 },
];
const fixtureEdges: GpuEdge[] = [
  { source: 0, target: 1, broken: false },
  { source: 0, target: 2, broken: true },
];
const fixtureGraph: GpuGraph = { nodes: fixtureNodes, edges: fixtureEdges };

describe("GpuGraphRenderer (fake WebGL2)", () => {
  it("probes capability and reports the GPU name", () => {
    const fake = new FakeGL();
    const renderer = new GpuGraphRenderer(makeCanvasWith(fake));
    expect(renderer.available).toBe(true);
    expect(renderer.capability.webgl2).toBe(true);
    expect(renderer.capability.renderer).toBe("FakeGPU");
    expect(renderer.capability.maxTexture).toBe(4096);
    renderer.destroy();
  });

  it("renders normal edges, broken edges and nodes (3 draw calls)", () => {
    const fake = new FakeGL();
    const renderer = new GpuGraphRenderer(makeCanvasWith(fake));
    renderer.setGraph(fixtureGraph);
    renderer.setLayout(makeLayout(3));
    renderer.resize(300, 200, 1);

    const stats = renderer.render();
    expect(stats.nodes).toBe(3);
    expect(stats.edges).toBe(2);
    expect(stats.drawCalls).toBe(3);
    expect(fake.drawCalls).toContain("elements:1");
    expect(fake.drawCalls.some((c) => c.startsWith("instanced:"))).toBe(true);
    renderer.destroy();
  });

  it("submits one base-instance draw per visible culling block", () => {
    const fake = new FakeGL();
    const renderer = new GpuGraphRenderer(makeCanvasWith(fake));
    renderer.setGraph(fixtureGraph);
    renderer.setLayout(makeLayout(3));
    renderer.resize(300, 200, 1);
    renderer.setVisibleBlocks([
      { base: 0, count: 1, minX: 0, minY: 0, maxX: 1, maxY: 1 },
      { base: 1, count: 2, minX: 0, minY: 0, maxX: 1, maxY: 1 },
    ]);

    renderer.render();
    expect(fake.drawCalls.filter((c) => c.startsWith("instanced-base:"))).toEqual([
      "instanced-base:4:1:0",
      "instanced-base:4:2:1",
    ]);
    renderer.destroy();
  });

  it("pick decodes the GPU colour id; a black backdrop returns -1", () => {
    const fake = new FakeGL();
    const renderer = new GpuGraphRenderer(makeCanvasWith(fake));
    renderer.setGraph(fixtureGraph);
    renderer.setLayout(makeLayout(3));
    renderer.resize(300, 200, 1);

    // backdrop: black → miss
    expect(renderer.pick(10, 10)).toBe(-1);

    // id 1 encoded → node index 0
    fake.nextRead = new Uint8Array([1, 0, 0, 255]);
    expect(renderer.pick(10, 10)).toBe(0);
    renderer.destroy();
  });

  it("destroy() deletes every program / buffer / VAO / texture / FBO and is idempotent", () => {
    const fake = new FakeGL();
    const renderer = new GpuGraphRenderer(makeCanvasWith(fake));
    renderer.setGraph(fixtureGraph);
    renderer.resize(300, 200, 1);
    renderer.pick(5, 5); // lazily creates the pick texture + FBO

    renderer.destroy();
    expect(fake.deleteCounts.program).toBe(3);
    // quad, quad index, from, to, meta, 2 edge ibos
    expect(fake.deleteCounts.buffer).toBe(7);
    expect(fake.deleteCounts.vao).toBe(3);
    expect(fake.deleteCounts.texture).toBe(1);
    expect(fake.deleteCounts.fbo).toBe(1);

    const before = { ...fake.deleteCounts };
    renderer.destroy(); // second call must not throw or delete twice
    expect(fake.deleteCounts).toEqual(before);
  });

  it("keeps rendering without throwing after context loss, and pick returns -1", () => {
    const fake = new FakeGL();
    const onLost = vi.fn();
    const renderer = new GpuGraphRenderer(makeCanvasWith(fake), { onContextLost: onLost });
    renderer.setGraph(fixtureGraph);
    renderer.setLayout(makeLayout(3));
    renderer.resize(300, 200, 1);

    renderer.reportContextLost();
    expect(onLost).toHaveBeenCalledTimes(1);

    const stats = renderer.render();
    expect(stats.drawCalls).toBe(0);
    expect(renderer.pick(5, 5)).toBe(-1);
    renderer.destroy();
  });

  it("marks unavailable when WebGL2 context is null", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(null);
    const renderer = new GpuGraphRenderer(canvas);
    expect(renderer.available).toBe(false);
    expect(renderer.capability.reason).toBe("no-webgl2");
    expect(renderer.render().drawCalls).toBe(0);
    expect(renderer.pick(1, 1)).toBe(-1);
    renderer.destroy();
    renderer.destroy(); // idempotent with no GL
  });

  it("marks program-link failure as unavailable and still destroys cleanly", () => {
    const fake = new FakeGL();
    fake.linkOk = false;
    const renderer = new GpuGraphRenderer(makeCanvasWith(fake));
    expect(renderer.available).toBe(false);
    expect(renderer.capability.reason).toBe("program-link");
    renderer.destroy();
  });
});
