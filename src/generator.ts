import type { ParsedSvg, SvgShape, Triangle, GeneratorOptions, Point } from "./types";
import { triangulatePolygon, flipY, triangleMinAltitude } from "./geometry";

function fmt(n: number): string {
  // format number to reasonable precision, trim trailing zeros
  return parseFloat(n.toFixed(4)).toString();
}

function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

interface HalfPlaneParams {
  angle: number; // degrees
  px: number;    // mm
  py: number;    // mm
}

function computeHalfPlane(
  p1: Point, p2: Point, interior: Point
): HalfPlaneParams {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const angle = rad2deg(Math.atan2(dy, dx));

  // left normal in local frame: (-dy, dx)
  // check if interior point is on the left side
  const nx = -dy, ny = dx;
  const dot = nx * (interior.x - p1.x) + ny * (interior.y - p1.y);

  if (dot >= 0) {
    // interior is on the left side — half-plane is on the left
    return { angle, px: p1.x, py: p1.y };
  } else {
    // interior is on the right side — flip by rotating 180°
    return { angle: angle + 180, px: p1.x, py: p1.y };
  }
}

function generateTriangleMcad(tri: Triangle, bigSize: number): string {
  const mid: Point = {
    x: (tri.a.x + tri.b.x + tri.c.x) / 3,
    y: (tri.a.y + tri.b.y + tri.c.y) / 3,
  };

  const hp1 = computeHalfPlane(tri.a, tri.b, mid);
  const hp2 = computeHalfPlane(tri.b, tri.c, mid);
  const hp3 = computeHalfPlane(tri.c, tri.a, mid);

  const half = fmt(bigSize / 2);
  const big = fmt(bigSize);

  const parts = [hp1, hp2, hp3].map(
    hp =>
      `Rect(width = ${big}mm, height = ${big}mm)` +
      `.translate(y = ${half}mm)` +
      `.rotate(angle = ${fmt(hp.angle)}deg)` +
      `.translate(x = ${fmt(hp.px)}mm, y = ${fmt(hp.py)}mm)`
  );

  return `(${parts[0]})\n    & (${parts[1]})\n    & (${parts[2]})`;
}

function generateShapeMcad(
  shape: SvgShape,
  svgHeight: number,
  bigSize: number,
  shapeIndex: number
): { code: string; varName: string } | null {
  const varName = `s${shapeIndex}`;

  switch (shape.type) {
    case "rect": {
      // flip Y: SVG top-left (x,y) → MicroCAD center
      const cx = shape.x + shape.width / 2;
      const cy = svgHeight - (shape.y + shape.height / 2);

      if (shape.rx > 0 || shape.ry > 0) {
        const r = Math.min(shape.rx, shape.ry);
        return {
          varName,
          code: `  ${varName} = RoundedRect(width = ${fmt(shape.width)}mm, height = ${fmt(shape.height)}mm, radius = ${fmt(r)}mm)\n    .translate(x = ${fmt(cx)}mm, y = ${fmt(cy)}mm);`,
        };
      }

      return {
        varName,
        code: `  ${varName} = Rect(width = ${fmt(shape.width)}mm, height = ${fmt(shape.height)}mm)\n    .translate(x = ${fmt(cx)}mm, y = ${fmt(cy)}mm);`,
      };
    }

    case "circle": {
      const cy = svgHeight - shape.cy;
      return {
        varName,
        code: `  ${varName} = Circle(radius = ${fmt(shape.r)}mm, center = (x = ${fmt(shape.cx)}mm, y = ${fmt(cy)}mm));`,
      };
    }

    case "ring": {
      const cy = svgHeight - shape.cy;
      return {
        varName,
        code: `  ${varName} = Ring(outer_radius = ${fmt(shape.outerR)}mm, inner_radius = ${fmt(shape.innerR)}mm)\n    .translate(x = ${fmt(shape.cx)}mm, y = ${fmt(cy)}mm);`,
      };
    }

    case "ellipse": {
      const cy = svgHeight - shape.cy;
      // approximate ellipse with scaled circle
      const maxR = Math.max(shape.rx, shape.ry);
      const sx = shape.rx / maxR;
      const sy = shape.ry / maxR;
      return {
        varName,
        code: `  ${varName} = Circle(radius = ${fmt(maxR)}mm)\n    .scale(x = ${fmt(sx)}, y = ${fmt(sy)})\n    .translate(x = ${fmt(shape.cx)}mm, y = ${fmt(cy)}mm);`,
      };
    }

    case "polygon": {
      // triangulate and generate
      const triangles = triangulatePolygon(shape.subPaths, shape.fillRule);
      if (triangles.length === 0) return null;

      // flip Y for all triangle vertices
      const flippedTriangles: Triangle[] = triangles.map(t => ({
        a: flipY(t.a, svgHeight),
        b: flipY(t.b, svgHeight),
        c: flipY(t.c, svgHeight),
      }));

      // filter out degenerate/near-collinear triangles (min altitude < 0.05mm)
      const validTriangles = flippedTriangles.filter(t => triangleMinAltitude(t) > 0.05);
      if (validTriangles.length === 0) return null;

      const lines: string[] = [];
      const triVars: string[] = [];

      for (let i = 0; i < validTriangles.length; i++) {
        const tv = `${varName}_t${i}`;
        triVars.push(tv);
        const triCode = generateTriangleMcad(validTriangles[i], bigSize);
        lines.push(`  ${tv} = ${triCode};`);
      }

      // union all triangles
      if (triVars.length === 1) {
        lines.push(`  ${varName} = ${triVars[0]};`);
      } else {
        // union in batches to avoid extremely long lines
        const batchSize = 10;
        if (triVars.length <= batchSize) {
          lines.push(`  ${varName} = ${triVars.join("\n    | ")};`);
        } else {
          const batchVars: string[] = [];
          for (let b = 0; b < triVars.length; b += batchSize) {
            const batch = triVars.slice(b, b + batchSize);
            const bv = `${varName}_b${Math.floor(b / batchSize)}`;
            batchVars.push(bv);
            lines.push(`  ${bv} = ${batch.join("\n    | ")};`);
          }
          lines.push(`  ${varName} = ${batchVars.join("\n    | ")};`);
        }
      }

      return { varName, code: lines.join("\n") };
    }

    default:
      return null;
  }
}

export function generateMcad(svg: ParsedSvg, options: GeneratorOptions): string {
  const { thickness, bigSize } = options;
  const lines: string[] = [];

  lines.push("// Generated by svg-to-mcad");
  lines.push(`// Source dimensions: ${fmt(svg.width)} x ${fmt(svg.height)}`);
  lines.push(`// Thickness: ${fmt(thickness)}mm`);
  lines.push("");
  lines.push("use std::geo2d::*;");
  lines.push("use std::ops::*;");
  lines.push("");

  const shapeResults: { varName: string; code: string }[] = [];

  for (let i = 0; i < svg.shapes.length; i++) {
    const result = generateShapeMcad(svg.shapes[i], svg.height, bigSize, i);
    if (result) {
      shapeResults.push(result);
    }
  }

  if (shapeResults.length === 0) {
    lines.push("// No filled shapes found in SVG");
    return lines.join("\n") + "\n";
  }

  // generate sketch
  lines.push("sketch SvgShape() {");
  for (const r of shapeResults) {
    lines.push(r.code);
    lines.push("");
  }

  // final union
  if (shapeResults.length === 1) {
    lines.push(`  ${shapeResults[0].varName};`);
  } else {
    lines.push(`  ${shapeResults.map(r => r.varName).join("\n    | ")};`);
  }
  lines.push("}");
  lines.push("");

  // extrude
  lines.push(`SvgShape().extrude(height = ${fmt(thickness)}mm);`);
  lines.push("");

  return lines.join("\n");
}
