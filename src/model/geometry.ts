/** Physical coordinates are stored without display rounding. */
export interface PointMm { x: number; y: number }
export interface RectMm extends PointMm { w: number; h: number }
/** Row-major matrix mapping mm coordinates to mm coordinates. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];
