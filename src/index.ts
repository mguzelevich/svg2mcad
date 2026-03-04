import { parseArgs } from "util";
import { parseSvg } from "./svg-parser";
import { generateMcad } from "./generator";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    thickness: { type: "string", short: "t", default: "3" },
    output: { type: "string", short: "o" },
    scale: { type: "string", short: "s", default: "1" },
    tolerance: { type: "string", short: "r", default: "0.5" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`svg-to-mcad — Convert SVG to MicroCAD (.µcad) flat extrusion

Usage:
  bun run src/index.ts <input.svg> [options]

Options:
  -t, --thickness <mm>    Extrusion thickness in mm (default: 3)
  -s, --scale <factor>    Scale factor for SVG units → mm (default: 1)
  -r, --tolerance <mm>    Curve linearization tolerance in mm (default: 0.5)
  -o, --output <file>     Output file path (default: <input>.µcad)
  -h, --help              Show this help

Examples:
  bun run src/index.ts logo.svg -t 5
  bun run src/index.ts icon.svg -t 2 -s 0.26 -o icon.µcad
`);
  process.exit(0);
}

const inputFile = positionals[0];
const thickness = parseFloat(values.thickness!);
const scale = parseFloat(values.scale!);
const tolerance = parseFloat(values.tolerance!);
const outputFile = values.output || inputFile.replace(/\.svg$/i, ".µcad");

// read SVG
const svgContent = await Bun.file(inputFile).text();

// parse
const svg = parseSvg(svgContent, tolerance);

// apply scale
if (scale !== 1) {
  svg.width *= scale;
  svg.height *= scale;
  for (const shape of svg.shapes) {
    switch (shape.type) {
      case "rect":
        shape.x *= scale;
        shape.y *= scale;
        shape.width *= scale;
        shape.height *= scale;
        shape.rx *= scale;
        shape.ry *= scale;
        break;
      case "circle":
        shape.cx *= scale;
        shape.cy *= scale;
        shape.r *= scale;
        break;
      case "ring":
        shape.cx *= scale;
        shape.cy *= scale;
        shape.outerR *= scale;
        shape.innerR *= scale;
        break;
      case "ellipse":
        shape.cx *= scale;
        shape.cy *= scale;
        shape.rx *= scale;
        shape.ry *= scale;
        break;
      case "polygon":
        for (const sp of shape.subPaths) {
          for (const p of sp.points) {
            p.x *= scale;
            p.y *= scale;
          }
        }
        break;
      case "polyline":
        for (const p of shape.points) {
          p.x *= scale;
          p.y *= scale;
        }
        break;
    }
  }
}

// compute bigSize for half-plane rects
const bigSize = Math.max(svg.width, svg.height) * 5;

// generate
const mcadCode = generateMcad(svg, { thickness, bigSize });

// write output
await Bun.write(outputFile, mcadCode);

const shapeCount = svg.shapes.length;
console.log(`Converted ${inputFile} → ${outputFile}`);
console.log(`  Shapes: ${shapeCount}, Thickness: ${thickness}mm, Scale: ${scale}x`);
console.log(`  SVG size: ${svg.width.toFixed(1)} x ${svg.height.toFixed(1)} mm`);
