/** Map 0.01–20 mm onto a CSS preview disc inside a 36px frame. */
export function previewDiscCssPx(sizeMm: number, maxMm = 20): number {
  const t = Math.max(0, Math.min(1, (sizeMm - 0.01) / (maxMm - 0.01)));
  return Math.max(2, Math.round(2 + t * 34));
}

const positiveFloor = (min: number, max: number) => min > 0 ? min : Math.min(max, Math.max(0.01, max / 1000));

/** Convert a normalized slider position to a length with fine control at small sizes. */
export function exponentialMmValue(position: number, min: number, max: number): number {
  const t = Math.max(0, Math.min(1, position));
  if (max <= min) return min;
  if (min <= 0 && t === 0) return 0;
  const floor = positiveFloor(min, max);
  return floor * Math.pow(max / floor, t);
}

export function exponentialMmPosition(value: number, min: number, max: number): number {
  if (max <= min || (min <= 0 && value <= 0)) return 0;
  const floor = positiveFloor(min, max);
  return Math.max(0, Math.min(1, Math.log(Math.max(floor, value) / floor) / Math.log(max / floor)));
}
