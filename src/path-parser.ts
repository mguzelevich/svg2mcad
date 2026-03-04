import type { Point, SubPath } from "./types";

interface PathCommand {
  type: string;
  args: number[];
}

function tokenizePathData(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  let currentCmd = "";
  let args: number[] = [];

  const argCounts: Record<string, number> = {
    M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1,
    C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2,
    A: 7, a: 7, Z: 0, z: 0,
  };

  function flush() {
    if (!currentCmd) return;
    const count = argCounts[currentCmd] ?? 0;
    if (count === 0) {
      commands.push({ type: currentCmd, args: [] });
    } else {
      // split accumulated args into groups of `count`
      for (let i = 0; i < args.length; i += count) {
        const group = args.slice(i, i + count);
        if (group.length === count) {
          // subsequent M/m groups become L/l
          const cmdType =
            commands.length > 0 && i > 0 && (currentCmd === "M" || currentCmd === "m")
              ? currentCmd === "M" ? "L" : "l"
              : currentCmd;
          commands.push({ type: cmdType, args: group });
        }
      }
    }
    args = [];
  }

  while ((match = re.exec(d)) !== null) {
    if (match[1]) {
      flush();
      currentCmd = match[1];
      if (currentCmd === "Z" || currentCmd === "z") {
        commands.push({ type: currentCmd, args: [] });
        currentCmd = "";
      }
    } else if (match[2] !== undefined) {
      args.push(parseFloat(match[2]));
    }
  }
  flush();

  return commands;
}

function cubicBezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function quadraticBezierPoint(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function flatness(p0: Point, p1: Point, p2: Point, p3: Point): number {
  const ux = 3 * p1.x - 2 * p0.x - p3.x;
  const uy = 3 * p1.y - 2 * p0.y - p3.y;
  const vx = 3 * p2.x - 2 * p3.x - p0.x;
  const vy = 3 * p2.y - 2 * p3.y - p0.y;
  return Math.max(ux * ux + uy * uy, vx * vx + vy * vy);
}

export function linearizeCubicBezier(
  p0: Point, p1: Point, p2: Point, p3: Point, tolerance: number
): Point[] {
  const toleranceSq = 16 * tolerance * tolerance;

  function subdivide(p0: Point, p1: Point, p2: Point, p3: Point, result: Point[]) {
    if (flatness(p0, p1, p2, p3) <= toleranceSq) {
      result.push(p3);
      return;
    }
    const mid = cubicBezierPoint(p0, p1, p2, p3, 0.5);
    const p01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const p12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const p23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
    const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
    const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 };
    const p0123 = { x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2 };
    subdivide(p0, p01, p012, p0123, result);
    subdivide(p0123, p123, p23, p3, result);
  }

  const result: Point[] = [];
  subdivide(p0, p1, p2, p3, result);
  return result;
}

export function linearizeQuadraticBezier(
  p0: Point, p1: Point, p2: Point, tolerance: number
): Point[] {
  // convert to cubic and linearize
  const cp1: Point = {
    x: p0.x + (2 / 3) * (p1.x - p0.x),
    y: p0.y + (2 / 3) * (p1.y - p0.y),
  };
  const cp2: Point = {
    x: p2.x + (2 / 3) * (p1.x - p2.x),
    y: p2.y + (2 / 3) * (p1.y - p2.y),
  };
  return linearizeCubicBezier(p0, cp1, cp2, p2, tolerance);
}

export function linearizeArc(
  p0: Point,
  rx: number, ry: number,
  xRotationDeg: number,
  largeArc: boolean, sweep: boolean,
  p1: Point,
  tolerance: number
): Point[] {
  // SVG arc to center parameterization
  if (rx === 0 || ry === 0) return [p1];

  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (xRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // step 1: compute (x1', y1')
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // step 2: correct radii if needed
  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    rx *= sqrtLambda;
    ry *= sqrtLambda;
  }

  // step 3: compute (cx', cy')
  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;
  let sq = (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq);
  if (sq < 0) sq = 0;
  let coef = Math.sqrt(sq);
  if (largeArc === sweep) coef = -coef;

  const cxp = coef * (rx * y1p) / ry;
  const cyp = coef * (-(ry * x1p) / rx);

  // step 4: compute center and angles
  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;

  function vecAngle(ux: number, uy: number, vx: number, vy: number): number {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let ang = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
  }

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = vecAngle(
    (x1p - cxp) / rx, (y1p - cyp) / ry,
    (-x1p - cxp) / rx, (-y1p - cyp) / ry
  );

  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  // step 5: generate points
  const numSegments = Math.max(4, Math.ceil(Math.abs(dtheta) / (Math.PI / 8)));
  const points: Point[] = [];

  for (let i = 1; i <= numSegments; i++) {
    const t = theta1 + (i / numSegments) * dtheta;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    points.push({
      x: cosPhi * rx * cosT - sinPhi * ry * sinT + cx,
      y: sinPhi * rx * cosT + cosPhi * ry * sinT + cy,
    });
  }

  return points;
}

export function parseSvgPath(d: string, tolerance = 0.5): SubPath[] {
  const commands = tokenizePathData(d);
  const subPaths: SubPath[] = [];
  let currentPoints: Point[] = [];
  let cx = 0, cy = 0; // current point
  let sx = 0, sy = 0; // start of current subpath
  let lastCp: Point | null = null; // last control point for smooth curves
  let lastCmd = "";

  function startNewSubPath(x: number, y: number) {
    if (currentPoints.length > 0) {
      subPaths.push({ points: currentPoints, closed: false });
    }
    currentPoints = [{ x, y }];
    sx = x;
    sy = y;
  }

  for (const cmd of commands) {
    const a = cmd.args;
    switch (cmd.type) {
      case "M":
        startNewSubPath(a[0], a[1]);
        cx = a[0]; cy = a[1];
        break;
      case "m":
        startNewSubPath(cx + a[0], cy + a[1]);
        cx += a[0]; cy += a[1];
        break;

      case "L":
        cx = a[0]; cy = a[1];
        currentPoints.push({ x: cx, y: cy });
        break;
      case "l":
        cx += a[0]; cy += a[1];
        currentPoints.push({ x: cx, y: cy });
        break;

      case "H":
        cx = a[0];
        currentPoints.push({ x: cx, y: cy });
        break;
      case "h":
        cx += a[0];
        currentPoints.push({ x: cx, y: cy });
        break;

      case "V":
        cy = a[0];
        currentPoints.push({ x: cx, y: cy });
        break;
      case "v":
        cy += a[0];
        currentPoints.push({ x: cx, y: cy });
        break;

      case "C": {
        const pts = linearizeCubicBezier(
          { x: cx, y: cy }, { x: a[0], y: a[1] }, { x: a[2], y: a[3] }, { x: a[4], y: a[5] }, tolerance
        );
        currentPoints.push(...pts);
        lastCp = { x: a[2], y: a[3] };
        cx = a[4]; cy = a[5];
        break;
      }
      case "c": {
        const pts = linearizeCubicBezier(
          { x: cx, y: cy },
          { x: cx + a[0], y: cy + a[1] },
          { x: cx + a[2], y: cy + a[3] },
          { x: cx + a[4], y: cy + a[5] },
          tolerance
        );
        currentPoints.push(...pts);
        lastCp = { x: cx + a[2], y: cy + a[3] };
        cx += a[4]; cy += a[5];
        break;
      }

      case "S": {
        const cp1 = lastCmd === "C" || lastCmd === "c" || lastCmd === "S" || lastCmd === "s"
          ? { x: 2 * cx - (lastCp?.x ?? cx), y: 2 * cy - (lastCp?.y ?? cy) }
          : { x: cx, y: cy };
        const pts = linearizeCubicBezier(
          { x: cx, y: cy }, cp1, { x: a[0], y: a[1] }, { x: a[2], y: a[3] }, tolerance
        );
        currentPoints.push(...pts);
        lastCp = { x: a[0], y: a[1] };
        cx = a[2]; cy = a[3];
        break;
      }
      case "s": {
        const cp1 = lastCmd === "C" || lastCmd === "c" || lastCmd === "S" || lastCmd === "s"
          ? { x: 2 * cx - (lastCp?.x ?? cx), y: 2 * cy - (lastCp?.y ?? cy) }
          : { x: cx, y: cy };
        const pts = linearizeCubicBezier(
          { x: cx, y: cy }, cp1,
          { x: cx + a[0], y: cy + a[1] },
          { x: cx + a[2], y: cy + a[3] },
          tolerance
        );
        currentPoints.push(...pts);
        lastCp = { x: cx + a[0], y: cy + a[1] };
        cx += a[2]; cy += a[3];
        break;
      }

      case "Q": {
        const pts = linearizeQuadraticBezier(
          { x: cx, y: cy }, { x: a[0], y: a[1] }, { x: a[2], y: a[3] }, tolerance
        );
        currentPoints.push(...pts);
        lastCp = { x: a[0], y: a[1] };
        cx = a[2]; cy = a[3];
        break;
      }
      case "q": {
        const pts = linearizeQuadraticBezier(
          { x: cx, y: cy },
          { x: cx + a[0], y: cy + a[1] },
          { x: cx + a[2], y: cy + a[3] },
          tolerance
        );
        currentPoints.push(...pts);
        lastCp = { x: cx + a[0], y: cy + a[1] };
        cx += a[2]; cy += a[3];
        break;
      }

      case "T": {
        const cp = lastCmd === "Q" || lastCmd === "q" || lastCmd === "T" || lastCmd === "t"
          ? { x: 2 * cx - (lastCp?.x ?? cx), y: 2 * cy - (lastCp?.y ?? cy) }
          : { x: cx, y: cy };
        const pts = linearizeQuadraticBezier(
          { x: cx, y: cy }, cp, { x: a[0], y: a[1] }, tolerance
        );
        currentPoints.push(...pts);
        lastCp = cp;
        cx = a[0]; cy = a[1];
        break;
      }
      case "t": {
        const cp = lastCmd === "Q" || lastCmd === "q" || lastCmd === "T" || lastCmd === "t"
          ? { x: 2 * cx - (lastCp?.x ?? cx), y: 2 * cy - (lastCp?.y ?? cy) }
          : { x: cx, y: cy };
        const pts = linearizeQuadraticBezier(
          { x: cx, y: cy }, cp, { x: cx + a[0], y: cy + a[1] }, tolerance
        );
        currentPoints.push(...pts);
        lastCp = cp;
        cx += a[0]; cy += a[1];
        break;
      }

      case "A": {
        const pts = linearizeArc(
          { x: cx, y: cy }, a[0], a[1], a[2], !!a[3], !!a[4], { x: a[5], y: a[6] }, tolerance
        );
        currentPoints.push(...pts);
        cx = a[5]; cy = a[6];
        lastCp = null;
        break;
      }
      case "a": {
        const pts = linearizeArc(
          { x: cx, y: cy }, a[0], a[1], a[2], !!a[3], !!a[4],
          { x: cx + a[5], y: cy + a[6] }, tolerance
        );
        currentPoints.push(...pts);
        cx += a[5]; cy += a[6];
        lastCp = null;
        break;
      }

      case "Z":
      case "z":
        if (currentPoints.length > 0) {
          subPaths.push({ points: currentPoints, closed: true });
          currentPoints = [];
        }
        cx = sx; cy = sy;
        lastCp = null;
        break;
    }

    lastCmd = cmd.type;
  }

  if (currentPoints.length > 1) {
    subPaths.push({ points: currentPoints, closed: false });
  }

  return subPaths;
}
