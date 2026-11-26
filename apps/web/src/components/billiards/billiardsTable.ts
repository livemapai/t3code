// Table geometry in table units: the cloth is 1 wide and 2 long, top-down and portrait.
// The head (where the cue ball starts) is at the bottom, the rack at the top.

export const TABLE_WIDTH = 1;
export const TABLE_LENGTH = 2;
export const BALL_RADIUS = 0.0225;
/** Cushion plus wood beyond the cloth edge. */
export const RAIL_WIDTH = 0.075;
const CUSHION_DEPTH = 0.036;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const HEAD_SPOT: Point = { x: 0.5, y: 1.5 };
export const FOOT_SPOT: Point = { x: 0.5, y: 0.5 };

export interface Pocket {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** A ball whose centre comes this close drops. */
  readonly radius: number;
}

export const POCKETS: ReadonlyArray<Pocket> = [
  { id: 0, x: -0.014, y: -0.014, radius: 0.05 },
  { id: 1, x: 1.014, y: -0.014, radius: 0.05 },
  { id: 2, x: -0.034, y: 1, radius: 0.046 },
  { id: 3, x: 1.034, y: 1, radius: 0.046 },
  { id: 4, x: -0.014, y: 2.014, radius: 0.05 },
  { id: 5, x: 1.014, y: 2.014, radius: 0.05 },
];

// Where a cushion nose ends next to a corner, and half the side pocket opening.
const CORNER_MOUTH = 0.075;
const SIDE_MOUTH = 0.05;
const D = CUSHION_DEPTH;

/**
 * Each cushion as [jaw back, nose start, nose end, jaw back]: drawn as one polygon, and its three
 * edges facing the cloth are what balls bounce off.
 */
export const CUSHIONS: ReadonlyArray<ReadonlyArray<Point>> = (() => {
  const top: Point[] = [
    { x: CORNER_MOUTH - 0.027, y: -D },
    { x: CORNER_MOUTH, y: 0 },
    { x: 1 - CORNER_MOUTH, y: 0 },
    { x: 1 - CORNER_MOUTH + 0.027, y: -D },
  ];
  const leftUpper: Point[] = [
    { x: -D, y: CORNER_MOUTH - 0.027 },
    { x: 0, y: CORNER_MOUTH },
    { x: 0, y: 1 - SIDE_MOUTH },
    { x: -0.045, y: 1 - SIDE_MOUTH + 0.012 },
  ];
  const leftLower: Point[] = [
    { x: -0.045, y: 1 + SIDE_MOUTH - 0.012 },
    { x: 0, y: 1 + SIDE_MOUTH },
    { x: 0, y: 2 - CORNER_MOUTH },
    { x: -D, y: 2 - CORNER_MOUTH + 0.027 },
  ];
  const mirrorX = (points: Point[]) => points.map((p) => ({ x: TABLE_WIDTH - p.x, y: p.y }));
  const mirrorY = (points: Point[]) => points.map((p) => ({ x: p.x, y: TABLE_LENGTH - p.y }));
  return [top, mirrorY(top), leftUpper, leftLower, mirrorX(leftUpper), mirrorX(leftLower)];
})();

export interface Segment {
  readonly a: Point;
  readonly b: Point;
}

export const CUSHION_SEGMENTS: ReadonlyArray<Segment> = CUSHIONS.flatMap((polygon) => {
  const segments: Segment[] = [];
  for (let i = 0; i < polygon.length - 1; i++) {
    const a = polygon[i];
    const b = polygon[i + 1];
    if (a && b) segments.push({ a, b });
  }
  return segments;
});
