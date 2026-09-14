import {sampleWarp} from './sampleWarp';
import {deferredWarp} from './asyncWarp';
import { inverse, type Homography } from './homography';

interface GpuSampler {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
}
let gpu: GpuSampler | null | undefined;

function sampler(): GpuSampler | null {
  if (gpu !== undefined) return gpu;
  gpu = null;
  const canvas = document.createElement('canvas');
  let gl: WebGL2RenderingContext | null;
  try { gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true }); }
  catch { return null; }
  if (!gl || typeof gl.createShader !== 'function') return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
    void main() {
      vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`);
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform sampler2D sourceImage;
    uniform mat3 inverseMatrix;
    uniform vec2 sourceSize;
    uniform vec2 sourceOrigin;
    uniform vec2 targetOrigin;
    uniform float targetHeight;
    out vec4 color;
    vec4 samplePixel(ivec2 pixel) {
      if (any(lessThan(pixel, ivec2(0))) || any(greaterThanEqual(pixel, ivec2(sourceSize)))) return vec4(0.0);
      return texelFetch(sourceImage, pixel, 0);
    }
    void main() {
      vec2 p = vec2(gl_FragCoord.x, targetHeight - gl_FragCoord.y) + targetOrigin;
      vec3 q = inverseMatrix * vec3(p, 1.0);
      if (abs(q.z) < 0.0000000001) { color = vec4(0.0); return; }
      vec2 local = q.xy / q.z - sourceOrigin - vec2(0.5);
      ivec2 base = ivec2(floor(local));
      vec2 weight = fract(local);
      color = mix(mix(samplePixel(base), samplePixel(base + ivec2(1,0)), weight.x),
                  mix(samplePixel(base + ivec2(0,1)), samplePixel(base + ivec2(1,1)), weight.x), weight.y);
    }`);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
  const texture = gl.createTexture()!;
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); gpu = undefined; });
  return gpu = { canvas, gl, program, texture };
}

/** Inverse projective sampling. Origins and the matrix use the same pixel coordinate space. */
export function warpCanvas(
  source: HTMLCanvasElement,
  target: CanvasRenderingContext2D,
  matrix: Homography,
  sourceOrigin: { x: number; y: number },
  targetOrigin: { x: number; y: number },
  width: number,
  height: number,
): void {
  const inv = inverse(matrix);
  if (!inv) return;
  // Canvas 2D's affine path is both exact and substantially cheaper for ordinary transforms.
  if (Math.abs(matrix[6]) < 1e-12 && Math.abs(matrix[7]) < 1e-12 && Math.abs(matrix[8]) > 1e-12) {
    const m = matrix.map(v => v / matrix[8]);
    target.save(); target.setTransform(1,0,0,1,-targetOrigin.x,-targetOrigin.y);
    target.transform(m[0],m[3],m[1],m[4],m[2],m[5]);
    target.drawImage(source,sourceOrigin.x,sourceOrigin.y); target.restore(); return;
  }
  const backend = sampler();
  if (backend && (source.width*source.height+width*height*2)*4<=5*1024*1024 && Math.max(source.width, source.height, width, height) <= backend.gl.getParameter(backend.gl.MAX_TEXTURE_SIZE)) {
    const { gl, program, texture, canvas } = backend;
    canvas.width = width; canvas.height = height;
    gl.viewport(0,0,width,height); gl.useProgram(program); gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
    gl.uniform1i(gl.getUniformLocation(program,'sourceImage'),0);
    gl.uniformMatrix3fv(gl.getUniformLocation(program,'inverseMatrix'),false,new Float32Array([inv[0],inv[3],inv[6],inv[1],inv[4],inv[7],inv[2],inv[5],inv[8]]));
    gl.uniform2f(gl.getUniformLocation(program,'sourceSize'),source.width,source.height);
    gl.uniform2f(gl.getUniformLocation(program,'sourceOrigin'),sourceOrigin.x,sourceOrigin.y);
    gl.uniform2f(gl.getUniformLocation(program,'targetOrigin'),targetOrigin.x,targetOrigin.y);
    gl.uniform1f(gl.getUniformLocation(program,'targetHeight'),height);
    gl.drawArrays(gl.TRIANGLES,0,3);
    target.save(); target.setTransform(1,0,0,1,0,0); target.drawImage(canvas,0,0); target.restore();
    return;
  }
  const pixels = source.getContext('2d', { willReadFrequently: true })!.getImageData(0,0,source.width,source.height).data;
  const request={pixels,sourceWidth:source.width,sourceHeight:source.height,inverse:inv,sourceOrigin,targetOrigin,width,height};
  if (deferredWarp(request,target)) return;
  const output=target.createImageData(width,height);output.data.set(sampleWarp(request));
  target.putImageData(output,0,0);
}
