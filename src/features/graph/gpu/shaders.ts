/**
 * T-063 — GLSL ES 3.00 sources and the central attribute / uniform name table
 * for the WebGL2 graph renderer.
 *
 * Layout on the node VAO (locations pinned in the vertex shader):
 *   0  a_corner   vec2    per-vertex quad corner (-1..1), shared by instances
 *   1  a_from     vec2    instance: interpolation start position (display at rewind)
 *   2  a_radius   float   instance: world-space radius
 *   3  a_color    vec4    instance: RGBA in 0..1
 *   4  a_pickId   float   instance: 1-based node index for the colour-ID pass
 *   6  a_to       vec2    instance: interpolation target position (latest tick)
 *
 * The vertex shader mixes `a_from` → `a_to` with the `u_t` uniform; the per-frame
 * CPU cost is one scalar upload, never a per-node JS interpolation.
 *
 * The edge VAO binds location 0 = `a_from`, location 1 = `a_to`.
 */

/** Node vertex shader: instanced quads, world → clip projection, GPU mix. */
export const NODE_VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_from;
layout(location = 2) in float a_radius;
layout(location = 3) in vec4 a_color;
layout(location = 4) in float a_pickId;
layout(location = 6) in vec2 a_to;

uniform vec3 uCamera;   // x, y (world point at viewport centre), k (px per unit)
uniform vec2 uViewport;  // CSS px, width then height
uniform float u_t;       // interpolation factor 0..1
uniform float uIntro;    // first-open fade alpha 0..1

out vec2 v_local;
out vec4 v_color;
out float v_pickId;

void main() {
  vec2 worldPos = mix(a_from, a_to, u_t);
  vec2 screen = (worldPos - uCamera.xy) * uCamera.z + uViewport * 0.5;
  vec2 offset = a_corner * a_radius;
  vec2 clip = ((screen + offset) / uViewport * 2.0 - 1.0) * vec2(1.0, -1.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_local = a_corner;
  v_color = vec4(a_color.rgb, a_color.a * uIntro);
  v_pickId = a_pickId;
}
`;

/** Node fragment shader: discards outside the unit circle so instances stay round. */
export const NODE_FRAGMENT_SRC = `#version 300 es
precision mediump float;

in vec2 v_local;
in vec4 v_color;

out vec4 fragColor;

void main() {
  if (dot(v_local, v_local) > 1.0) {
    discard;
  }
  fragColor = v_color;
}
`;

/** Edge vertex shader: from/to mix, same world → clip path as nodes. */
export const EDGE_VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_from;
layout(location = 1) in vec2 a_to;

uniform vec3 uCamera;
uniform vec2 uViewport;
uniform float u_t;

void main() {
  vec2 worldPos = mix(a_from, a_to, u_t);
  vec2 screen = (worldPos - uCamera.xy) * uCamera.z + uViewport * 0.5;
  vec2 clip = screen / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

/** Edge fragment shader: single flat colour per draw call (normal / broken). */
export const EDGE_FRAGMENT_SRC = `#version 300 es
precision mediump float;

uniform vec4 uColor;

out vec4 fragColor;

void main() {
  fragColor = uColor;
}
`;

/**
 * Pick fragment shader: writes the 24-bit node id into RGB.
 * Id 0 is reserved for the clear colour (a miss); node indices are stored
 * 1-based on the instance attribute, so the backdrop decodes to 0.
 */
export const PICK_FRAGMENT_SRC = `#version 300 es
precision mediump float;

in float v_pickId;

out vec4 fragColor;

void main() {
  float id = v_pickId;
  float r = mod(id, 256.0);
  float g = mod(floor(id / 256.0), 256.0);
  float b = mod(floor(id / 65536.0), 256.0);
  fragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}
`;

/** Attribute names, kept in one place so VAO setup and shaders never drift. */
export const ATTR = {
  corner: "a_corner",
  from: "a_from",
  to: "a_to",
  radius: "a_radius",
  color: "a_color",
  pickId: "a_pickId",
} as const;

/** Uniform names. */
export const UNIFORM = {
  camera: "uCamera",
  viewport: "uViewport",
  tint: "uColor",
  t: "u_t",
  intro: "uIntro",
} as const;
