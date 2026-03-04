# svg2mcad

Converts SVG files to MicroCAD (`.µcad`) programs that produce 3D models by extruding flat shapes to a given thickness.

## Usage

convert

```bash
$ bun install
$ bun run svg2mcad <input.svg> [options]
```

evaluate microcad code

```bash
$ microcad eval test.µcad
```

preview

```bash
$ microcad-viewer test.µcad
```

export to stl

```bash
$ microcad export test.µcad
```

### Options

| Flag | Description | Default |
|---|---|---|
| `-t, --thickness <mm>` | Extrusion thickness in mm | 3 |
| `-s, --scale <factor>` | Scale factor for SVG units to mm | 1 |
| `-r, --tolerance <mm>` | Curve linearization tolerance in mm | 0.5 |
| `-o, --output <file>` | Output file path | `<input>.µcad` |

### Examples

```bash
bun run svg2mcad logo.svg -t 5
bun run svg2mcad icon.svg -t 2 -s 0.26 -o icon.µcad
```

## How it works

MicroCAD has no arbitrary polygon primitives — only basic shapes (`Rect`, `Circle`, `RoundedRect`, `Ring`, etc.) and boolean operations (`|` union, `&` intersect, `-` subtract).

The converter parses the SVG and picks the best representation for each element:

- **rect** → `Rect` / `RoundedRect`
- **circle** → `Circle`
- **ellipse** → scaled `Circle`
- **circle (stroke-only)** → `Ring`
- **path / polygon** → triangulated via earcut, each triangle = intersection of three rotated `Rect`s (half-plane intersection)

The result is wrapped in a `sketch` and extruded via `.extrude(height)`.

### SVG support

- All path commands (`M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `A`, `Z`)
- Bezier curve and arc linearization
- Nested transforms (`matrix`, `translate`, `rotate`, `scale`, `skew`)
- `fill-rule`: `evenodd` and `nonzero` (from attributes and `style`)
- Compound paths with nested contours and holes
- Stroke-only elements (circle → Ring, rect/path → offset polygon)

## References

- https://docs.microcad.xyz/language/book/index.html
- https://docs.microcad.xyz/tutorials/book/lego_brick/intro.html
- https://docs.rs/crate/microcad-std/latest/source/lib/std/
