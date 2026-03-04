export interface Point {
  x: number;
  y: number;
}

export interface SubPath {
  points: Point[];
  closed: boolean;
}

export interface Triangle {
  a: Point;
  b: Point;
  c: Point;
}

export type SvgShape =
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      rx: number;
      ry: number;
    }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "ring"; cx: number; cy: number; outerR: number; innerR: number }
  | { type: "polygon"; subPaths: SubPath[]; fillRule: string }
  | { type: "polyline"; points: Point[] };

export interface ParsedSvg {
  width: number;
  height: number;
  shapes: SvgShape[];
}

export interface GeneratorOptions {
  thickness: number;
  bigSize: number;
}
