import { invertHomography, transformPoint, type Homography } from '../../model';

export interface WarpOptions {
  interpolation: 'nearest' | 'linear' | 'cubic';
  meshDivisions?: number;
}

export function mmHomographyToPixels(matrix: Homography, ppi: number): Homography {
  const scale = ppi / 25.4;
  return [
    matrix[0], matrix[1], matrix[2] * scale,
    matrix[3], matrix[4], matrix[5] * scale,
    matrix[6] / scale, matrix[7] / scale, matrix[8],
  ];
}

export function pixelHomographyToMm(matrix: Homography, ppi: number): Homography {
  const scale = ppi / 25.4;
  return [
    matrix[0], matrix[1], matrix[2] / scale,
    matrix[3], matrix[4], matrix[5] / scale,
    matrix[6] * scale, matrix[7] * scale, matrix[8],
  ];
}

function triangleTransform(
  source: readonly { x: number; y: number }[],
  destination: readonly { x: number; y: number }[],
): DOMMatrix | null {
  const [s0, s1, s2] = source, [d0, d1, d2] = destination;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 1e-8) return null;
  const solve = (v0: number, v1: number, v2: number) => ({
    a: (v0 * (s1.y - s2.y) + v1 * (s2.y - s0.y) + v2 * (s0.y - s1.y)) / denominator,
    b: (v0 * (s2.x - s1.x) + v1 * (s0.x - s2.x) + v2 * (s1.x - s0.x)) / denominator,
    c: (v0 * (s1.x * s2.y - s2.x * s1.y) + v1 * (s2.x * s0.y - s0.x * s2.y) + v2 * (s0.x * s1.y - s1.x * s0.y)) / denominator,
  });
  const x = solve(d0.x, d1.x, d2.x), y = solve(d0.y, d1.y, d2.y);
  return new DOMMatrix([x.a, y.a, x.b, y.b, x.c, y.c]);
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  source: readonly [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  destination: readonly [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
): void {
  const matrix = triangleTransform(source, destination);
  if (!matrix) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(destination[0].x, destination[0].y);
  ctx.lineTo(destination[1].x, destination[1].y);
  ctx.lineTo(destination[2].x, destination[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(matrix);
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
}

/** Canvas 2D fallback: an adaptive-enough regular mesh, isolated from WebGL setup. */
export function warpCanvas2DMesh(
  source: HTMLCanvasElement,
  target: CanvasRenderingContext2D,
  matrix: Homography,
  options: WarpOptions,
): boolean {
  if (!invertHomography(matrix)) return false;
  const divisions = Math.max(2, Math.min(64, Math.round(options.meshDivisions ?? 16)));
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, target.canvas.width, target.canvas.height);
  target.imageSmoothingEnabled = options.interpolation !== 'nearest';
  target.imageSmoothingQuality = options.interpolation === 'cubic' ? 'high' : 'medium';
  for (let row = 0; row < divisions; row++) {
    const y0 = source.height * row / divisions, y1 = source.height * (row + 1) / divisions;
    for (let col = 0; col < divisions; col++) {
      const x0 = source.width * col / divisions, x1 = source.width * (col + 1) / divisions;
      const s00 = { x: x0, y: y0 }, s10 = { x: x1, y: y0 }, s11 = { x: x1, y: y1 }, s01 = { x: x0, y: y1 };
      const d00 = transformPoint(matrix, s00), d10 = transformPoint(matrix, s10);
      const d11 = transformPoint(matrix, s11), d01 = transformPoint(matrix, s01);
      if (!d00 || !d10 || !d11 || !d01) continue;
      drawTriangle(target, source, [s00, s10, s11], [d00, d10, d11]);
      drawTriangle(target, source, [s00, s11, s01], [d00, d11, d01]);
    }
  }
  target.restore();
  return true;
}

/**
 * WebGL2 path. Returning false is intentional when context creation/support fails;
 * callers then use the deterministic Canvas 2D mesh implementation.
 */
export function warpCanvasWebGL2(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  matrix: Homography,
  options: WarpOptions,
): boolean {
  const gl = target.getContext('webgl2', { premultipliedAlpha: true });
  const inverse = invertHomography(matrix);
  if (!gl || typeof gl.createShader !== 'function' || !inverse) return false;
  const shader = (type: number, code: string) => {
    const value = gl.createShader(type);
    if (!value) return null;
    gl.shaderSource(value, code);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) { gl.deleteShader(value); return null; }
    return value;
  };
  const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
    in vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
  `);
  const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform sampler2D u_source;
    uniform mat3 u_inverse;
    uniform vec2 u_sourceSize;
    uniform vec2 u_targetSize;
    out vec4 outColor;
    void main() {
      vec2 destination = vec2(gl_FragCoord.x, u_targetSize.y - gl_FragCoord.y);
      vec3 projected = u_inverse * vec3(destination, 1.0);
      if (abs(projected.z) < 0.000001) { outColor = vec4(0.0); return; }
      vec2 pixel = projected.xy / projected.z;
      if (pixel.x < 0.0 || pixel.y < 0.0 || pixel.x >= u_sourceSize.x || pixel.y >= u_sourceSize.y) {
        outColor = vec4(0.0); return;
      }
      outColor = texture(u_source, pixel / u_sourceSize);
    }
  `);
  if (!vertex || !fragment) return false;
  const program = gl.createProgram();
  if (!program) return false;
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteProgram(program);
    return false;
  }
  const buffer = gl.createBuffer(), texture = gl.createTexture();
  if (!buffer || !texture) return false;
  gl.viewport(0, 0, target.width, target.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const filter = options.interpolation === 'nearest' ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  // GLSL matrices are column-major; transpose the row-major domain matrix here.
  const columnMajor = new Float32Array([
    inverse[0], inverse[3], inverse[6], inverse[1], inverse[4], inverse[7], inverse[2], inverse[5], inverse[8],
  ]);
  gl.uniformMatrix3fv(gl.getUniformLocation(program, 'u_inverse'), false, columnMajor);
  gl.uniform2f(gl.getUniformLocation(program, 'u_sourceSize'), source.width, source.height);
  gl.uniform2f(gl.getUniformLocation(program, 'u_targetSize'), target.width, target.height);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  return gl.getError() === gl.NO_ERROR;
}
