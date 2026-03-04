import { XMLParser } from "fast-xml-parser";
import type { ParsedSvg, SvgShape, Point, SubPath } from "./types";
import { parseSvgPath } from "./path-parser";

interface Transform {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
}

const IDENTITY: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(t1: Transform, t2: Transform): Transform {
  return {
    a: t1.a * t2.a + t1.c * t2.b,
    b: t1.b * t2.a + t1.d * t2.b,
    c: t1.a * t2.c + t1.c * t2.d,
    d: t1.b * t2.c + t1.d * t2.d,
    e: t1.a * t2.e + t1.c * t2.f + t1.e,
    f: t1.b * t2.e + t1.d * t2.f + t1.f,
  };
}

function applyTransform(t: Transform, p: Point): Point {
  return {
    x: t.a * p.x + t.c * p.y + t.e,
    y: t.b * p.x + t.d * p.y + t.f,
  };
}

function parseTransformAttr(attr: string | undefined): Transform {
  if (!attr) return IDENTITY;

  let result = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]+)\)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(attr)) !== null) {
    const fn = m[1];
    const args = m[2].split(/[\s,]+/).map(Number);
    let t: Transform;

    switch (fn) {
      case "matrix":
        t = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
        break;
      case "translate":
        t = { a: 1, b: 0, c: 0, d: 1, e: args[0], f: args[1] ?? 0 };
        break;
      case "scale": {
        const sx = args[0];
        const sy = args[1] ?? sx;
        t = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
        break;
      }
      case "rotate": {
        const angle = (args[0] * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        if (args.length >= 3) {
          const cx = args[1], cy = args[2];
          t = multiply(
            { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy },
            multiply(
              { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 },
              { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy }
            )
          );
        } else {
          t = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
        }
        break;
      }
      case "skewX": {
        const tan = Math.tan((args[0] * Math.PI) / 180);
        t = { a: 1, b: 0, c: tan, d: 1, e: 0, f: 0 };
        break;
      }
      case "skewY": {
        const tan = Math.tan((args[0] * Math.PI) / 180);
        t = { a: 1, b: tan, c: 0, d: 1, e: 0, f: 0 };
        break;
      }
      default:
        t = IDENTITY;
    }
    result = multiply(result, t);
  }

  return result;
}

function attr(node: any, name: string, def = 0): number {
  const v = node[`@_${name}`];
  return v !== undefined ? parseFloat(v) : def;
}

function strAttr(node: any, name: string, def = ""): string {
  return node[`@_${name}`] ?? def;
}

interface ElementStyle {
  hasFill: boolean;
  hasStroke: boolean;
  strokeWidth: number;
  fillRule: string;
}

function getElementStyle(node: any): ElementStyle {
  let hasFill = true;
  let hasStroke = false;
  let strokeWidth = 1;
  let fillRule = "nonzero";

  // read from attributes
  const fill = strAttr(node, "fill", "").toLowerCase();
  if (fill === "none") hasFill = false;

  const stroke = strAttr(node, "stroke", "").toLowerCase();
  if (stroke && stroke !== "none" && stroke !== "") hasStroke = true;

  const swAttr = strAttr(node, "stroke-width");
  if (swAttr) strokeWidth = parseFloat(swAttr);

  const frAttr = strAttr(node, "fill-rule");
  if (frAttr) fillRule = frAttr;

  // override from style attribute (higher priority)
  const style = strAttr(node, "style", "");
  if (style) {
    const fillMatch = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/);
    if (fillMatch) {
      const fv = fillMatch[1].trim().toLowerCase();
      if (fv === "none") hasFill = false;
      else hasFill = true;
    }

    const strokeMatch = style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/);
    if (strokeMatch) {
      const sv = strokeMatch[1].trim().toLowerCase();
      hasStroke = sv !== "" && sv !== "none";
    }

    const swMatch = style.match(/stroke-width\s*:\s*([0-9.]+)/);
    if (swMatch) strokeWidth = parseFloat(swMatch[1]);

    const frMatch = style.match(/fill-rule\s*:\s*([^;]+)/);
    if (frMatch) fillRule = frMatch[1].trim();
  }

  return { hasFill, hasStroke, strokeWidth, fillRule };
}

function parsePointsList(str: string): Point[] {
  const nums = str.trim().split(/[\s,]+/).map(Number);
  const points: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

function transformSubPaths(subPaths: SubPath[], t: Transform): SubPath[] {
  return subPaths.map(sp => ({
    points: sp.points.map(p => applyTransform(t, p)),
    closed: sp.closed,
  }));
}

function transformScale(t: Transform): number {
  return Math.sqrt(t.a * t.a + t.b * t.b);
}

function offsetPolygon(points: Point[], offset: number): Point[] {
  const n = points.length;
  if (n < 3) return points;
  const result: Point[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    const e1x = curr.x - prev.x, e1y = curr.y - prev.y;
    const e2x = next.x - curr.x, e2y = next.y - curr.y;
    const len1 = Math.sqrt(e1x * e1x + e1y * e1y) || 1;
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y) || 1;

    // outward normals (for CCW polygon, left normal points outward)
    const n1x = -e1y / len1, n1y = e1x / len1;
    const n2x = -e2y / len2, n2y = e2x / len2;

    const avgNx = n1x + n2x, avgNy = n1y + n2y;
    const avgLen = Math.sqrt(avgNx * avgNx + avgNy * avgNy) || 1;
    const nx = avgNx / avgLen, ny = avgNy / avgLen;

    const dot = n1x * nx + n1y * ny;
    const miter = dot > 0.1 ? offset / dot : offset;
    // clamp miter to avoid spikes at sharp angles
    const clampedMiter = Math.min(Math.abs(miter), Math.abs(offset) * 4) * Math.sign(miter);

    result.push({ x: curr.x + nx * clampedMiter, y: curr.y + ny * clampedMiter });
  }

  return result;
}

function collectShapes(
  node: any,
  parentTransform: Transform,
  shapes: SvgShape[],
  tolerance: number
) {
  if (!node || typeof node !== "object") return;

  const nodeTransform = multiply(parentTransform, parseTransformAttr(strAttr(node, "transform")));

  // handle <rect>
  if (node.rect) {
    const rects = Array.isArray(node.rect) ? node.rect : [node.rect];
    for (const r of rects) {
      const es = getElementStyle(r);
      if (!es.hasFill && !es.hasStroke) continue;
      const t = multiply(nodeTransform, parseTransformAttr(strAttr(r, "transform")));
      const x = attr(r, "x");
      const y = attr(r, "y");
      const w = attr(r, "width");
      const h = attr(r, "height");
      let rx = attr(r, "rx");
      let ry = attr(r, "ry");
      if (rx && !ry) ry = rx;
      if (ry && !rx) rx = ry;
      if (w > 0 && h > 0) {
        if (es.hasFill) {
          const corners: Point[] = [
            applyTransform(t, { x, y }),
            applyTransform(t, { x: x + w, y }),
            applyTransform(t, { x: x + w, y: y + h }),
            applyTransform(t, { x, y: y + h }),
          ];
          if (t.b !== 0 || t.c !== 0) {
            const subPaths = rectToSubPaths(x, y, w, h, rx, ry, tolerance);
            shapes.push({ type: "polygon", subPaths: transformSubPaths(subPaths, t), fillRule: "nonzero" });
          } else {
            shapes.push({
              type: "rect",
              x: corners[0].x, y: corners[0].y,
              width: w * Math.abs(t.a), height: h * Math.abs(t.d),
              rx: rx * Math.abs(t.a), ry: ry * Math.abs(t.d),
            });
          }
        }
        if (es.hasStroke && !es.hasFill) {
          // stroke-only rect → offset polygon pair
          const sw = es.strokeWidth / 2;
          const outerPts = [
            { x: x - sw, y: y - sw },
            { x: x + w + sw, y: y - sw },
            { x: x + w + sw, y: y + h + sw },
            { x: x - sw, y: y + h + sw },
          ];
          const innerPts = [
            { x: x + sw, y: y + sw },
            { x: x + w - sw, y: y + sw },
            { x: x + w - sw, y: y + h - sw },
            { x: x + sw, y: y + h - sw },
          ];
          shapes.push({
            type: "polygon",
            subPaths: [
              { points: outerPts.map(p => applyTransform(t, p)), closed: true },
              { points: innerPts.map(p => applyTransform(t, p)), closed: true },
            ],
            fillRule: "evenodd",
          });
        }
      }
    }
  }

  // handle <circle>
  if (node.circle) {
    const circles = Array.isArray(node.circle) ? node.circle : [node.circle];
    for (const c of circles) {
      const es = getElementStyle(c);
      if (!es.hasFill && !es.hasStroke) continue;
      const t = multiply(nodeTransform, parseTransformAttr(strAttr(c, "transform")));
      const cx = attr(c, "cx");
      const cy = attr(c, "cy");
      const r = attr(c, "r");
      if (r > 0) {
        const center = applyTransform(t, { x: cx, y: cy });
        const scale = transformScale(t);

        if (es.hasFill) {
          if (t.a === t.d && t.b === 0 && t.c === 0) {
            shapes.push({ type: "circle", cx: center.x, cy: center.y, r: r * t.a });
          } else {
            const subPaths = circleToSubPaths(cx, cy, r, tolerance);
            shapes.push({ type: "polygon", subPaths: transformSubPaths(subPaths, t), fillRule: "nonzero" });
          }
        }
        if (es.hasStroke && !es.hasFill) {
          // stroke-only circle → ring
          const sw = es.strokeWidth * scale;
          const outerR = r * scale + sw / 2;
          const innerR = r * scale - sw / 2;
          if (innerR > 0) {
            shapes.push({ type: "ring", cx: center.x, cy: center.y, outerR, innerR });
          } else {
            shapes.push({ type: "circle", cx: center.x, cy: center.y, r: outerR });
          }
        }
      }
    }
  }

  // handle <ellipse>
  if (node.ellipse) {
    const ellipses = Array.isArray(node.ellipse) ? node.ellipse : [node.ellipse];
    for (const e of ellipses) {
      const es = getElementStyle(e);
      if (!es.hasFill && !es.hasStroke) continue;
      const t = multiply(nodeTransform, parseTransformAttr(strAttr(e, "transform")));
      const cx = attr(e, "cx");
      const cy = attr(e, "cy");
      const rx = attr(e, "rx");
      const ry = attr(e, "ry");
      if (rx > 0 && ry > 0) {
        if (es.hasFill) {
          if (t.b === 0 && t.c === 0 && Math.abs(rx * t.a - ry * t.d) < 0.001) {
            const center = applyTransform(t, { x: cx, y: cy });
            shapes.push({ type: "circle", cx: center.x, cy: center.y, r: rx * t.a });
          } else {
            const subPaths = ellipseToSubPaths(cx, cy, rx, ry, tolerance);
            shapes.push({ type: "polygon", subPaths: transformSubPaths(subPaths, t), fillRule: "nonzero" });
          }
        }
        // stroke-only ellipse → polygon offset (approximate)
        if (es.hasStroke && !es.hasFill) {
          const scale = transformScale(t);
          const sw = es.strokeWidth * scale / 2;
          const outerSp = ellipseToSubPaths(cx, cy, rx + es.strokeWidth / 2, ry + es.strokeWidth / 2, tolerance);
          const innerSp = ellipseToSubPaths(cx, cy, rx - es.strokeWidth / 2, ry - es.strokeWidth / 2, tolerance);
          shapes.push({
            type: "polygon",
            subPaths: [
              ...transformSubPaths(outerSp, t),
              ...transformSubPaths(innerSp, t),
            ],
            fillRule: "evenodd",
          });
        }
      }
    }
  }

  // handle <polygon>
  if (node.polygon) {
    const polygons = Array.isArray(node.polygon) ? node.polygon : [node.polygon];
    for (const pg of polygons) {
      const es = getElementStyle(pg);
      if (!es.hasFill && !es.hasStroke) continue;
      const t = multiply(nodeTransform, parseTransformAttr(strAttr(pg, "transform")));
      const pts = parsePointsList(strAttr(pg, "points")).map(p => applyTransform(t, p));
      if (pts.length >= 3) {
        if (es.hasFill) {
          shapes.push({ type: "polygon", subPaths: [{ points: pts, closed: true }], fillRule: es.fillRule });
        }
        if (es.hasStroke && !es.hasFill) {
          const scale = transformScale(t);
          const sw = es.strokeWidth * scale / 2;
          shapes.push({
            type: "polygon",
            subPaths: [
              { points: offsetPolygon(pts, sw), closed: true },
              { points: offsetPolygon(pts, -sw), closed: true },
            ],
            fillRule: "evenodd",
          });
        }
      }
    }
  }

  // handle <polyline>
  if (node.polyline) {
    const polylines = Array.isArray(node.polyline) ? node.polyline : [node.polyline];
    for (const pl of polylines) {
      const es = getElementStyle(pl);
      if (!es.hasFill && !es.hasStroke) continue;
      const t = multiply(nodeTransform, parseTransformAttr(strAttr(pl, "transform")));
      const pts = parsePointsList(strAttr(pl, "points")).map(p => applyTransform(t, p));
      if (pts.length >= 3 && es.hasFill) {
        shapes.push({ type: "polygon", subPaths: [{ points: pts, closed: true }], fillRule: "nonzero" });
      }
    }
  }

  // handle <path>
  if (node.path) {
    const paths = Array.isArray(node.path) ? node.path : [node.path];
    for (const p of paths) {
      const es = getElementStyle(p);
      if (!es.hasFill && !es.hasStroke) continue;
      const t = multiply(nodeTransform, parseTransformAttr(strAttr(p, "transform")));
      const d = strAttr(p, "d");
      if (d) {
        const subPaths = parseSvgPath(d, tolerance);
        if (es.hasFill) {
          shapes.push({
            type: "polygon",
            subPaths: transformSubPaths(subPaths, t),
            fillRule: es.fillRule,
          });
        }
        if (es.hasStroke && !es.hasFill) {
          // stroke-only path → offset each closed subpath
          const scale = transformScale(t);
          const sw = es.strokeWidth * scale / 2;
          const strokeSubPaths: SubPath[] = [];
          for (const sp of subPaths) {
            if (sp.closed && sp.points.length >= 3) {
              const tPts = sp.points.map(pt => applyTransform(t, pt));
              strokeSubPaths.push({ points: offsetPolygon(tPts, sw), closed: true });
              strokeSubPaths.push({ points: offsetPolygon(tPts, -sw), closed: true });
            }
          }
          if (strokeSubPaths.length > 0) {
            shapes.push({ type: "polygon", subPaths: strokeSubPaths, fillRule: "evenodd" });
          }
        }
      }
    }
  }

  // recurse into <g> groups and svg element
  for (const key of ["g", "svg"]) {
    if (node[key]) {
      const groups = Array.isArray(node[key]) ? node[key] : [node[key]];
      for (const g of groups) {
        collectShapes(g, nodeTransform, shapes, tolerance);
      }
    }
  }

  // handle <use> (basic support)
  // handle <defs> - skip (they are referenced by use)
}

function rectToSubPaths(x: number, y: number, w: number, h: number, rx: number, ry: number, tolerance: number): SubPath[] {
  if (rx <= 0 && ry <= 0) {
    return [{
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      closed: true,
    }];
  }

  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  const pts: Point[] = [];
  const steps = Math.max(4, Math.ceil((Math.PI / 2) / (tolerance / Math.max(rx, ry))));

  // top-right corner
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    pts.push({ x: x + w - rx + rx * Math.cos(Math.PI / 2 - t), y: y + ry - ry * Math.sin(Math.PI / 2 - t) });
  }
  // bottom-right corner
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    pts.push({ x: x + w - rx + rx * Math.cos(t), y: y + h - ry + ry * Math.sin(t) });
  }
  // bottom-left corner
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    pts.push({ x: x + rx - rx * Math.cos(Math.PI / 2 - t), y: y + h - ry + ry * Math.sin(Math.PI / 2 - t) });
  }
  // top-left corner
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    pts.push({ x: x + rx - rx * Math.cos(t), y: y + ry - ry * Math.sin(t) });
  }

  return [{ points: pts, closed: true }];
}

function circleToSubPaths(cx: number, cy: number, r: number, tolerance: number): SubPath[] {
  const steps = Math.max(16, Math.ceil((2 * Math.PI * r) / tolerance));
  const pts: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return [{ points: pts, closed: true }];
}

function ellipseToSubPaths(cx: number, cy: number, rx: number, ry: number, tolerance: number): SubPath[] {
  const steps = Math.max(16, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / tolerance));
  const pts: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return [{ points: pts, closed: true }];
}

export function parseSvg(svgContent: string, tolerance = 0.5): ParsedSvg {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    trimValues: true,
  });

  const doc = parser.parse(svgContent);
  const svgNode = doc.svg;

  if (!svgNode) {
    throw new Error("No <svg> root element found");
  }

  // parse viewBox or width/height
  let width = 100, height = 100;
  const viewBox = strAttr(svgNode, "viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length >= 4) {
      width = parts[2];
      height = parts[3];
    }
  } else {
    width = attr(svgNode, "width", 100);
    height = attr(svgNode, "height", 100);
  }

  const shapes: SvgShape[] = [];
  collectShapes(svgNode, IDENTITY, shapes, tolerance);

  return { width, height, shapes };
}
