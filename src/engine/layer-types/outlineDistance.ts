function distanceTransform1d(
  input: Float64Array,
  output: Float64Array,
  length: number,
  sites: Int32Array,
  bounds: Float64Array,
): void {
  let k = 0;
  sites[0] = 0;
  bounds[0] = -Infinity;
  bounds[1] = Infinity;
  for (let q = 1; q < length; q++) {
    let site = sites[k];
    let split =
      (input[q] + q * q - (input[site] + site * site)) / (2 * (q - site));
    while (split <= bounds[k] && k > 0) {
      k--;
      site = sites[k];
      split =
        (input[q] + q * q - (input[site] + site * site)) / (2 * (q - site));
    }
    k++;
    sites[k] = q;
    bounds[k] = split;
    bounds[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < length; q++) {
    while (bounds[k + 1] < q) k++;
    const delta = q - sites[k];
    output[q] = delta * delta + input[sites[k]];
  }
}


/** Exact squared Euclidean distance from thresholded alpha, in a cropped region. */
export function outlineSquaredDistances(
  pixels: Uint8ClampedArray,
  sourceWidth: number,
  x0: number,
  y0: number,
  width: number,
  height: number,
  threshold: number,
): Float32Array {
  const squared = new Float32Array(width * height);
  const infinity = 1e20;
  // Binary rows need only the nearest seed on each side. Avoid constructing a
  // parabola envelope for this first pass, where every seed has zero cost.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const sourceRow = ((y + y0) * sourceWidth + x0) * 4 + 3;
    let distance = width + height;
    for (let x = 0; x < width; x++) {
      const alpha = pixels[sourceRow + x * 4];
      distance = alpha > 0 && alpha >= threshold ? 0 : distance + 1;
      squared[row + x] = distance < width ? distance * distance : infinity;
    }
    distance = width + height;
    for (let x = width - 1; x >= 0; x--) {
      if (squared[row + x] === 0) distance = 0;
      else {
        distance++;
        if (distance < width)
          squared[row + x] = Math.min(squared[row + x], distance * distance);
      }
    }
  }
  const input = new Float64Array(height);
  const output = new Float64Array(height);
  const sites = new Int32Array(height);
  const bounds = new Float64Array(height + 1);
  for (let x = 0; x < width; x++) {
    let allSeeds = true;
    for (let y = 0; y < height; y++) {
      const value = squared[y * width + x];
      input[y] = value;
      if (value !== 0) allSeeds = false;
    }
    // Opaque interiors already have their final distance (zero).
    if (allSeeds) continue;
    distanceTransform1d(input, output, height, sites, bounds);
    for (let y = 0; y < height; y++) squared[y * width + x] = output[y];
  }
  return squared;
}
