/** Work counters for deterministic sparse-memory acceptance checks. */
export const rasterStats = {
  copiedPixels: 0,
  sampledPixels: 0,
  nativeTransformedPixels: 0,
  sourceReadbackPixels: 0,
  encodedTiles: 0,
  changedTiles: 0,
  maxTemporaryPixels: 0,
};
