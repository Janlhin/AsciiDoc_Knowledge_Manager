/**
 * T-063 — WebGL2 renderer for the standalone GPU graph view.
 *
 * Scope (per module contract): renderer only. No React, no entry wiring.
 *
 * Rendering strategy
 * - Nodes: instanced quads (`drawElementsInstanced` / base-instance block
 *   draws), one call per visible culling block.
 * - Edges: `drawElements(LINES)` against a static uint32 index buffer; normal
 *   and broken edges get separate calls so the broken colour stays visible.
 * - Positions: two dynamic buffers (`from` / `to`); the vertex shader mixes
 *   them with the `u_t` uniform. The per-frame CPU upload is one scalar; the
 *   two position buffers are rewritten only on a layout tick (rewind) or drag.
 * - Picking: an offscreen RGBA8 FBO renders the pick program; one `readPixels`
 *   decodes the 24-bit node id. A miss (or any readback failure) returns -1
 *   and the caller falls back to the CPU `PickIndex`.
 *
 * Per-tick upload: only the two position buffers (`bufferSubData`, ~1.6MB at
 * 100k nodes combined). Meta (radius / colour / pick id) is static after
 * `setGraph` and is rewritten only when palette or selection changes.
 */

import type {
  CameraState,
  GpuCapability,
  GpuGraph,
  GpuNode,
  GraphPalette,
  LayoutState,
  RendererStats,
  RenderSelection,
} from "./types";
import type { BlockLayout, CullBlock } from "./culling";
import {
  EDGE_FRAGMENT_SRC,
  EDGE_VERTEX_SRC,
  NODE_FRAGMENT_SRC,
  NODE_VERTEX_SRC,
  PICK_FRAGMENT_SRC,
  UNIFORM,
} from "./shaders";
import {
  META_STRIDE,
  POS_STRIDE,
  decodePickColor,
  estimateBytes,
  hexToRgba,
  nodeRadius,
  packNodeInstances,
  resolveNodeColor,
  type NodePack,
} from "./geometry";
import { FALLBACK_PALETTE } from "./palette";

export interface RendererHooks {
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

/** Default GPU memory guard before VBOs are allocated. */
const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;

/** Shared unit quad: 4 corners + 6 indices, reused by every node instance. */
const QUAD_CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

/**
 * WebGL2 core base-instance draw (absent from the bundled TS DOM lib). The
 * method is part of the WebGL2 spec; the cast only bridges the type gap.
 */
type WebGL2BaseInstance = WebGL2RenderingContext & {
  drawElementsInstancedBaseInstance(
    mode: number,
    count: number,
    type: number,
    offset: number,
    instanceCount: number,
    baseInstance: number,
  ): void;
};

interface CompiledProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface RendererBuffers {
  quad: WebGLBuffer | null;
  quadIndex: WebGLBuffer | null;
  from: WebGLBuffer | null;
  to: WebGLBuffer | null;
  meta: WebGLBuffer | null;
  normalEdge: WebGLBuffer | null;
  brokenEdge: WebGLBuffer | null;
}

interface RendererVaos {
  node: WebGLVertexArrayObject | null;
  edge: WebGLVertexArrayObject | null;
  pick: WebGLVertexArrayObject | null;
}

const EMPTY_SELECTION: RenderSelection = {
  hovered: null,
  selected: null,
  anchor: null,
  boxed: [],
};

export class GpuGraphRenderer {
  /** False when WebGL2 is unavailable, linking failed, or the memory guard tripped. */
  available: boolean;
  /** Capability probe result consumed by the degradation banner. */
  capability: GpuCapability;

  private readonly canvas: HTMLCanvasElement;
  private readonly hooks: RendererHooks;

  private gl: WebGL2RenderingContext | null;
  private disposed = false;
  private contextLost = false;

  private programs: {
    node: CompiledProgram | null;
    edge: CompiledProgram | null;
    pick: CompiledProgram | null;
  } = { node: null, edge: null, pick: null };
  private buffers: RendererBuffers = {
    quad: null,
    quadIndex: null,
    from: null,
    to: null,
    meta: null,
    normalEdge: null,
    brokenEdge: null,
  };
  private vaos: RendererVaos = { node: null, edge: null, pick: null };
  private pickTexture: WebGLTexture | null = null;
  private pickFbo: WebGLFramebuffer | null = null;

  private pack: NodePack | null = null;
  private nodes: GpuNode[] = [];
  private layout: LayoutState | null = null;
  /** `to` position mirror, kept alongside `pack.positions` (the `from` mirror). */
  private toPositions: Float32Array = new Float32Array(0);
  private blockLayout: BlockLayout | null = null;
  private visibleBlocks: readonly CullBlock[] | null = null;
  /** base-instance draw exposed by this GL backend (some ANGLE builds omit it). */
  private supportsBaseInstance: boolean = false;
  private motionT = 1;
  private introAlpha = 1;
  private camera: CameraState = { x: 0, y: 0, k: 1 };
  private selection: RenderSelection = { ...EMPTY_SELECTION, boxed: [] };
  private palette: GraphPalette = { ...FALLBACK_PALETTE };
  private view = { w: 0, h: 0, dpr: 1 };

  constructor(canvas: HTMLCanvasElement, hooks?: RendererHooks) {
    this.canvas = canvas;
    this.hooks = hooks ?? {};

    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl2", {
        antialias: true,
        alpha: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      });
    } catch {
      gl = null;
    }

    if (!gl) {
      this.gl = null;
      this.available = false;
      this.capability = {
        webgl2: false,
        maxTexture: 0,
        budgetBytes: DEFAULT_BUDGET_BYTES,
        reason: "no-webgl2",
      };
      return;
    }

    this.gl = gl;
    this.supportsBaseInstance =
      typeof (gl as WebGL2BaseInstance).drawElementsInstancedBaseInstance === "function";
    const renderer = probeRenderer(gl);
    const maxTexture = readIntParameter(gl, gl.MAX_TEXTURE_SIZE);
    this.capability = {
      webgl2: true,
      maxTexture,
      budgetBytes: DEFAULT_BUDGET_BYTES,
      renderer,
    };

    if (!this.rebuildAll()) {
      this.available = false;
      this.capability = { ...this.capability, reason: "program-link" };
      this.releaseAllResources();
      return;
    }

    this.available = true;
    this.attachContextListeners();
  }

  // ---------------------------------------------------------------- setup

  /** Recompile programs and rebuild static GL objects. Used by ctor and restore. */
  private rebuildAll(): boolean {
    const gl = this.gl;
    if (!gl) return false;

    const node = this.buildProgram(NODE_VERTEX_SRC, NODE_FRAGMENT_SRC);
    const edge = this.buildProgram(EDGE_VERTEX_SRC, EDGE_FRAGMENT_SRC);
    const pick = this.buildProgram(NODE_VERTEX_SRC, PICK_FRAGMENT_SRC);
    if (!node || !edge || !pick) return false;
    this.programs = { node, edge, pick };

    this.buffers.quad = gl.createBuffer();
    this.buffers.quadIndex = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.quadIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, QUAD_INDICES, gl.STATIC_DRAW);

    this.vaos.node = gl.createVertexArray();
    this.vaos.edge = gl.createVertexArray();
    this.vaos.pick = gl.createVertexArray();

    if (this.pack) {
      this.uploadGraphBuffers();
      this.refillMetaColors();
      this.syncPositions();
    }
    return true;
  }

  private buildProgram(vsSrc: string, fsSrc: string): CompiledProgram | null {
    const gl = this.gl;
    if (!gl) return null;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[gpu-graph] program link failed:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of [UNIFORM.camera, UNIFORM.viewport, UNIFORM.tint, UNIFORM.t, UNIFORM.intro]) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms };
  }

  private compileShader(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[gpu-graph] shader compile failed:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  // ------------------------------------------------------------------ state

  setGraph(g: GpuGraph): void {
    this.nodes = g.nodes.slice();
    this.pack = packNodeInstances(g, { perm: this.blockLayout?.perm });
    this.toPositions = new Float32Array(this.pack.positions.length);
    if (!this.gl || !this.available || this.contextLost) return;

    const bytes = estimateBytes(this.pack);
    if (bytes > this.capability.budgetBytes) {
      this.capability = { ...this.capability, reason: "memory" };
      this.available = false;
      this.releaseGraphBuffers();
      return;
    }
    this.uploadGraphBuffers();
    this.refillMetaColors();
  }

  /** Attach the culling block layout (permutation + packed ranges). */
  setBlockLayout(layout: BlockLayout | null): void {
    this.blockLayout = layout;
  }

  setLayout(layout: LayoutState): void {
    this.layout = layout;
    this.syncPositions();
  }

  setCamera(c: CameraState): void {
    this.camera = { x: c.x, y: c.y, k: c.k };
  }

  setSelection(s: RenderSelection): void {
    this.selection = {
      hovered: s.hovered,
      selected: s.selected,
      anchor: s.anchor,
      boxed: s.boxed.slice(),
    };
    this.refillMetaColors();
  }

  setPalette(p: GraphPalette): void {
    this.palette = { ...p };
    this.refillMetaColors();
  }

  resize(w: number, h: number, dpr: number): void {
    this.view = {
      w: Math.max(0, w),
      h: Math.max(0, h),
      dpr: Math.max(1, dpr),
    };
    if (!this.gl) return;
    this.canvas.width = Math.round(this.view.w * this.view.dpr);
    this.canvas.height = Math.round(this.view.h * this.view.dpr);
    this.destroyPickTarget();
  }

  /** Per-frame motion state: interpolation factor 0..1 and intro alpha 0..1. */
  setMotion(t: number, introAlpha: number): void {
    this.motionT = Math.min(1, Math.max(0, t));
    this.introAlpha = Math.min(1, Math.max(0, introAlpha));
  }

  /**
   * Visible packed blocks for this frame. `null` means "no culling" (submit the
   * whole instance set); an empty array submits no nodes.
   */
  setVisibleBlocks(blocks: readonly CullBlock[] | null): void {
    this.visibleBlocks = blocks;
  }

  /**
   * Rewind the interpolation: `from` = current display arrays, `to` = latest
   * targets. Arrays are in original node order; the block permutation remaps
   * them onto packed instance order. Called from the tick subscriber only.
   */
  rewind(fromX: Float32Array, fromY: Float32Array, toX: Float32Array, toY: Float32Array): void {
    const pack = this.pack;
    if (!pack) return;
    this.fillPacked(pack.positions, fromX, fromY);
    this.fillPacked(this.toPositions, toX, toY);
    this.uploadPositionBuffers();
  }

  /** Pin one node's both ends to the pointer position (drag follow). */
  pinDisplay(originalIndex: number, x: number, y: number): void {
    const gl = this.gl;
    const pack = this.pack;
    const perm = this.blockLayout?.perm;
    if (!gl || !pack || originalIndex < 0 || originalIndex >= this.nodes.length) return;
    const packed = perm ? perm[originalIndex] : originalIndex;
    if (packed < 0 || packed >= pack.nodeCount) return;
    pack.positions[packed * POS_STRIDE] = x;
    pack.positions[packed * POS_STRIDE + 1] = y;
    this.toPositions[packed * POS_STRIDE] = x;
    this.toPositions[packed * POS_STRIDE + 1] = y;
    const byteOffset = packed * POS_STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.from);
    gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, pack.positions, packed * POS_STRIDE, POS_STRIDE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.to);
    gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, this.toPositions, packed * POS_STRIDE, POS_STRIDE);
  }

  /** Push the latest layout positions into both dynamic position buffers (per-tick). */
  syncPositions(): void {
    const pack = this.pack;
    const layout = this.layout;
    if (!pack || !layout) return;
    this.fillPacked(pack.positions, layout.x, layout.y);
    this.fillPacked(this.toPositions, layout.x, layout.y);
    this.uploadPositionBuffers();
  }

  /** Remap original-order source arrays onto packed instance order. */
  private fillPacked(
    out: Float32Array,
    srcX: Float32Array,
    srcY: Float32Array,
  ): void {
    const pack = this.pack;
    if (!pack) return;
    const invPerm = this.blockLayout?.invPerm;
    const n = Math.min(pack.nodeCount, srcX.length, srcY.length);
    for (let p = 0; p < n; p++) {
      const orig = invPerm ? invPerm[p] : p;
      out[p * POS_STRIDE] = srcX[orig] ?? 0;
      out[p * POS_STRIDE + 1] = srcY[orig] ?? 0;
    }
  }

  private uploadPositionBuffers(): void {
    const gl = this.gl;
    const pack = this.pack;
    if (!gl || !pack || !this.buffers.from || !this.buffers.to) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.from);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pack.positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.to);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.toPositions);
  }

  // ----------------------------------------------------------------- render

  render(): RendererStats {
    const t0 = performance.now();
    const stats: RendererStats = {
      nodes: this.pack?.nodeCount ?? 0,
      edges: this.pack?.edgeCount ?? 0,
      drawCalls: 0,
      frameMs: 0,
      gpu: this.capability.renderer ?? "unknown",
    };

    const gl = this.gl;
    if (!this.available || this.contextLost || this.disposed || !gl || !this.pack) {
      stats.frameMs = performance.now() - t0;
      return stats;
    }
    if (this.view.w === 0 || this.view.h === 0) {
      stats.frameMs = performance.now() - t0;
      return stats;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const bg = hexToRgba(this.palette.bg);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let drawCalls = 0;
    const linkColor = hexToRgba(this.palette.link, [0.27, 0.27, 0.27, 0.8]);
    const brokenColor = hexToRgba(this.palette.broken, [0.878, 0.424, 0.459, 1]);

    if (this.pack.normalEdges.length > 0 && this.buffers.normalEdge) {
      this.drawEdgePass(this.buffers.normalEdge, this.pack.normalEdges.length, linkColor);
      drawCalls++;
    }
    if (this.pack.brokenEdges.length > 0 && this.buffers.brokenEdge) {
      this.drawEdgePass(this.buffers.brokenEdge, this.pack.brokenEdges.length, brokenColor);
      drawCalls++;
    }
    if (this.pack.nodeCount > 0) {
      const program = this.programs.node;
      if (program) {
        gl.useProgram(program.program);
        this.uploadCommonUniforms(program);
        gl.bindVertexArray(this.vaos.node);
        drawCalls += this.drawNodeInstances(program);
      }
    }

    stats.drawCalls = drawCalls;
    stats.frameMs = performance.now() - t0;
    return stats;
  }

  /**
   * Node submission: one instanced draw per visible block when the backend
   * exposes base-instance draws; otherwise a single full-graph instanced pass
   * (the block grid still drives CPU-side visibility counts / picking).
   */
  private drawNodeInstances(program: CompiledProgram): number {
    const gl = this.gl;
    const pack = this.pack;
    if (!gl || !pack) return 0;
    const blocks = this.visibleBlocks;
    if (blocks === null || !this.supportsBaseInstance) {
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        QUAD_INDICES.length,
        gl.UNSIGNED_SHORT,
        0,
        pack.nodeCount,
      );
      return 1;
    }
    let calls = 0;
    const gl2 = gl as WebGL2BaseInstance;
    for (const block of blocks) {
      if (block.count <= 0) continue;
      gl2.drawElementsInstancedBaseInstance(
        gl.TRIANGLES,
        QUAD_INDICES.length,
        gl.UNSIGNED_SHORT,
        0,
        block.count,
        block.base,
      );
      calls++;
    }
    return calls;
  }

  private drawEdgePass(
    indexBuffer: WebGLBuffer,
    indexCount: number,
    color: [number, number, number, number],
  ): void {
    const gl = this.gl;
    const program = this.programs.edge;
    if (!gl || !program) return;
    gl.useProgram(program.program);
    this.uploadCommonUniforms(program);
    const tint = program.uniforms[UNIFORM.tint];
    if (tint) gl.uniform4f(tint, color[0], color[1], color[2], color[3]);
    const tLoc = program.uniforms[UNIFORM.t];
    if (tLoc) gl.uniform1f(tLoc, this.motionT);
    gl.bindVertexArray(this.vaos.edge);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.drawElements(gl.LINES, indexCount, gl.UNSIGNED_INT, 0);
  }

  // ------------------------------------------------------------------ pick

  /**
   * Read the node id under a CSS-pixel point. Returns -1 on a miss, when the
   * context is lost, or if the GPU readback fails (caller then uses CPU index).
   * The id is mapped back from packed instance order to the original graph index.
   */
  pick(cssX: number, cssY: number): number {
    const gl = this.gl;
    const pack = this.pack;
    if (!this.available || this.contextLost || this.disposed || !gl || !pack) return -1;
    if (cssX < 0 || cssY < 0 || cssX >= this.view.w || cssY >= this.view.h) return -1;

    try {
      if (!this.ensurePickTarget()) return -1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const program = this.programs.pick;
      if (!program) return -1;
      gl.useProgram(program.program);
      this.uploadCommonUniforms(program);
      gl.bindVertexArray(this.vaos.pick);
      this.drawNodeInstances(program);

      const px = Math.min(this.canvas.width - 1, Math.round(cssX * this.view.dpr));
      const py = Math.min(
        this.canvas.height - 1,
        Math.round((this.view.h - cssY) * this.view.dpr) - 1,
      );
      const buf = new Uint8Array(4);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const raw = decodePickColor(buf[0], buf[1], buf[2]);
      if (raw === 0) return -1;
      const packed = raw - 1;
      const invPerm = this.blockLayout?.invPerm;
      const original = invPerm ? invPerm[packed] : packed;
      return original >= 0 && original < this.nodes.length ? original : -1;
    } catch {
      if (gl) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return -1;
    }
  }

  private ensurePickTarget(): boolean {
    const gl = this.gl;
    if (!gl) return false;
    if (this.pickFbo && this.pickTexture) return true;
    if (this.canvas.width === 0 || this.canvas.height === 0) return false;

    this.pickTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      this.canvas.width,
      this.canvas.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.pickFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.pickTexture,
      0,
    );
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      this.destroyPickTarget();
      return false;
    }
    return true;
  }

  // ------------------------------------------------------- context lifecycle

  /** Mark the context lost (test seam; the real event fires this too). */
  reportContextLost(): void {
    if (this.disposed) return;
    this.contextLost = true;
    this.hooks.onContextLost?.();
  }

  /** Rebuild GL resources after `webglcontextrestored`; layout state is kept. */
  restore(): void {
    if (this.disposed || !this.gl) return;
    this.releaseAllResources();
    this.contextLost = false;
    if (this.rebuildAll()) {
      this.available = true;
      this.capability = { ...this.capability, reason: undefined };
      this.hooks.onContextRestored?.();
    } else {
      this.available = false;
      this.capability = { ...this.capability, reason: "program-link" };
    }
  }

  /** Idempotent: delete every GL object and detach listeners. Safe to call twice. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachContextListeners();
    this.releaseAllResources();
    this.gl = null;
    this.available = false;
    this.pack = null;
    this.nodes = [];
  }

  // ------------------------------------------------------------ internals

  private uploadGraphBuffers(): void {
    const gl = this.gl;
    const pack = this.pack;
    if (!gl || !pack) return;

    this.buffers.from = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.from);
    gl.bufferData(gl.ARRAY_BUFFER, pack.positions, gl.DYNAMIC_DRAW);

    this.buffers.to = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.to);
    gl.bufferData(gl.ARRAY_BUFFER, this.toPositions, gl.DYNAMIC_DRAW);

    this.buffers.meta = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.meta);
    gl.bufferData(gl.ARRAY_BUFFER, pack.meta, gl.STATIC_DRAW);

    this.buffers.normalEdge = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.normalEdge);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, pack.normalEdges, gl.STATIC_DRAW);

    this.buffers.brokenEdge = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.brokenEdge);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, pack.brokenEdges, gl.STATIC_DRAW);

    this.bindNodeVao(this.vaos.node);
    this.bindNodeVao(this.vaos.pick);
    this.bindEdgeVao(this.vaos.edge);
  }

  private bindNodeVao(vao: WebGLVertexArrayObject | null): void {
    const gl = this.gl;
    if (!gl || !vao || !this.buffers.quad || !this.buffers.from || !this.buffers.to || !this.buffers.meta) return;
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.from);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.to);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(6, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.meta);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, META_STRIDE * 4, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, META_STRIDE * 4, 4);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, META_STRIDE * 4, (META_STRIDE - 1) * 4);
    gl.vertexAttribDivisor(4, 1);

    gl.bindVertexArray(null);
  }

  private bindEdgeVao(vao: WebGLVertexArrayObject | null): void {
    const gl = this.gl;
    if (!gl || !vao || !this.buffers.from || !this.buffers.to) return;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.from);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.to);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private refillMetaColors(): void {
    const gl = this.gl;
    const pack = this.pack;
    if (!pack) return;
    for (let i = 0; i < pack.nodeCount; i++) {
      const node = this.nodes[i];
      if (!node) continue;
      const [r, g, b, a] = resolveNodeColor(node, i, this.palette, this.selection);
      const offset = i * META_STRIDE;
      pack.meta[offset] = nodeRadius(node.degree, 1);
      pack.meta[offset + 1] = r;
      pack.meta[offset + 2] = g;
      pack.meta[offset + 3] = b;
      pack.meta[offset + 4] = a;
    }
    if (gl && this.buffers.meta) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.meta);
      gl.bufferData(gl.ARRAY_BUFFER, pack.meta, gl.STATIC_DRAW);
    }
  }

  private uploadCommonUniforms(program: CompiledProgram): void {
    const gl = this.gl;
    if (!gl) return;
    const cam = program.uniforms[UNIFORM.camera];
    if (cam) gl.uniform3f(cam, this.camera.x, this.camera.y, this.camera.k);
    const view = program.uniforms[UNIFORM.viewport];
    if (view) gl.uniform2f(view, this.view.w, this.view.h);
    const tLoc = program.uniforms[UNIFORM.t];
    if (tLoc) gl.uniform1f(tLoc, this.motionT);
    const introLoc = program.uniforms[UNIFORM.intro];
    if (introLoc) gl.uniform1f(introLoc, this.introAlpha);
  }

  private attachContextListeners(): void {
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
  }

  private detachContextListeners(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.reportContextLost();
  };

  private handleContextRestored = (): void => {
    this.restore();
  };

  private releaseGraphBuffers(): void {
    const gl = this.gl;
    if (!gl) return;
    this.deleteBuffer("from");
    this.deleteBuffer("to");
    this.deleteBuffer("meta");
    this.deleteBuffer("normalEdge");
    this.deleteBuffer("brokenEdge");
  }

  private releaseAllResources(): void {
    const gl = this.gl;
    if (!gl) return;

    for (const key of ["node", "edge", "pick"] as const) {
      const program = this.programs[key];
      if (program) {
        gl.deleteProgram(program.program);
        this.programs[key] = null;
      }
    }
    for (const key of Object.keys(this.buffers) as Array<keyof RendererBuffers>) {
      this.deleteBuffer(key);
    }
    for (const key of Object.keys(this.vaos) as Array<keyof RendererVaos>) {
      const vao = this.vaos[key];
      if (vao) {
        gl.deleteVertexArray(vao);
        this.vaos[key] = null;
      }
    }
    this.destroyPickTarget();
  }

  private deleteBuffer(key: keyof RendererBuffers): void {
    const gl = this.gl;
    const buffer = this.buffers[key];
    if (gl && buffer) {
      gl.deleteBuffer(buffer);
      this.buffers[key] = null;
    }
  }

  private destroyPickTarget(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.pickTexture) {
      gl.deleteTexture(this.pickTexture);
      this.pickTexture = null;
    }
    if (this.pickFbo) {
      gl.deleteFramebuffer(this.pickFbo);
      this.pickFbo = null;
    }
  }
}

function probeRenderer(gl: WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) {
      const masked = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (typeof masked === "string" && masked) return masked;
    }
    const renderer = gl.getParameter(gl.RENDERER);
    return typeof renderer === "string" && renderer ? renderer : "unknown";
  } catch {
    return "unknown";
  }
}

function readIntParameter(gl: WebGL2RenderingContext, name: number): number {
  try {
    const value = gl.getParameter(name);
    return typeof value === "number" ? value : 0;
  } catch {
    return 0;
  }
}
