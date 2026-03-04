import earcut from "earcut";
import type { Point, SubPath, Triangle } from "./types";

export function signedArea(points: Point[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x - points[i].x) * (points[j].y + points[i].y);
  }
  return area / 2;
}

function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function centroid(points: Point[]): Point {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

interface RingInfo {
  points: Point[];
  area: number;
  absArea: number;
}

interface TreeNode {
  ring: RingInfo;
  children: TreeNode[];
  parent: TreeNode | null;
  depth: number;
  isFilled: boolean;
}

function buildContainmentTree(rings: RingInfo[], fillRule: string): TreeNode[] {
  // sort by absolute area descending (largest first)
  rings.sort((a, b) => b.absArea - a.absArea);

  const allNodes: TreeNode[] = [];

  for (const ring of rings) {
    const node: TreeNode = { ring, children: [], parent: null, depth: 0, isFilled: false };

    // find the innermost (smallest area) existing node that contains this ring's centroid
    let bestParent: TreeNode | null = null;
    const c = centroid(ring.points);

    for (const existing of allNodes) {
      if (pointInPolygon(c, existing.ring.points)) {
        if (!bestParent || existing.ring.absArea < bestParent.ring.absArea) {
          bestParent = existing;
        }
      }
    }

    if (bestParent) {
      node.parent = bestParent;
      bestParent.children.push(node);
      node.depth = bestParent.depth + 1;
    }

    allNodes.push(node);
  }

  // determine fill status
  for (const node of allNodes) {
    if (fillRule === "evenodd") {
      // even depth = filled, odd = unfilled
      node.isFilled = node.depth % 2 === 0;
    } else {
      // nonzero: sum winding contributions from root to this node
      let winding = 0;
      let current: TreeNode | null = node;
      while (current) {
        // CCW (negative area in screen coords) contributes -1, CW contributes +1
        winding += current.ring.area > 0 ? 1 : -1;
        current = current.parent;
      }
      node.isFilled = winding !== 0;
    }
  }

  return allNodes;
}

export function triangulatePolygon(subPaths: SubPath[], fillRule: string): Triangle[] {
  if (subPaths.length === 0) return [];

  const validPaths = subPaths.filter(sp => sp.points.length >= 3);
  if (validPaths.length === 0) return [];

  const rings: RingInfo[] = validPaths.map(sp => {
    const a = signedArea(sp.points);
    return { points: sp.points, area: a, absArea: Math.abs(a) };
  });

  const nodes = buildContainmentTree(rings, fillRule);
  const triangles: Triangle[] = [];

  // for each filled node, triangulate it with its direct unfilled children as holes
  for (const node of nodes) {
    if (!node.isFilled) continue;

    const holes = node.children.filter(c => !c.isFilled);

    // ensure outer ring winding for earcut (CCW = counter-clockwise expected)
    let outerPts = [...node.ring.points];
    if (signedArea(outerPts) > 0) outerPts.reverse();

    const coords: number[] = [];
    for (const p of outerPts) {
      coords.push(p.x, p.y);
    }

    const holeIndices: number[] = [];
    for (const hole of holes) {
      holeIndices.push(coords.length / 2);
      let holePts = [...hole.ring.points];
      // holes should be CW (opposite of outer)
      if (signedArea(holePts) < 0) holePts.reverse();
      for (const p of holePts) {
        coords.push(p.x, p.y);
      }
    }

    const indices = earcut(coords, holeIndices.length > 0 ? holeIndices : undefined);

    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i];
      const ib = indices[i + 1];
      const ic = indices[i + 2];
      triangles.push({
        a: { x: coords[ia * 2], y: coords[ia * 2 + 1] },
        b: { x: coords[ib * 2], y: coords[ib * 2 + 1] },
        c: { x: coords[ic * 2], y: coords[ic * 2 + 1] },
      });
    }
  }

  return triangles;
}

export function flipY(point: Point, height: number): Point {
  return { x: point.x, y: height - point.y };
}

export function triangleArea(t: Triangle): number {
  return Math.abs(
    (t.b.x - t.a.x) * (t.c.y - t.a.y) - (t.c.x - t.a.x) * (t.b.y - t.a.y)
  ) / 2;
}

export function triangleMinAltitude(t: Triangle): number {
  const area = triangleArea(t);
  if (area < 1e-12) return 0;
  const ab = Math.sqrt((t.b.x - t.a.x) ** 2 + (t.b.y - t.a.y) ** 2);
  const bc = Math.sqrt((t.c.x - t.b.x) ** 2 + (t.c.y - t.b.y) ** 2);
  const ca = Math.sqrt((t.a.x - t.c.x) ** 2 + (t.a.y - t.c.y) ** 2);
  const longest = Math.max(ab, bc, ca);
  if (longest < 1e-12) return 0;
  return (2 * area) / longest;
}
