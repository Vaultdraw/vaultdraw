---
when: \b(draw|drawing|diagram|sketch|whiteboard|flow ?chart|flow|architecture|mind ?map|layout|teach|explain|illustrate|visuali[sz]e|map out|lay out)\b
---
<!-- Based on the excalidraw-mcp cheat sheet (MIT, Excalidraw) -->
<!-- drawing-core -->
Draw with Excalidraw element JSON in "ops" order: background zone, shape, its arrows, next shape. Put `label` on shapes (`"label":{"text":"API"}`), never separate text for box labels. Bind arrows with `start`/`end` shape ids. Shapes at least 120x60, gaps 40+, fonts 16+ (titles 20+), no emoji. Colour means something: use palette names, pastel fills, same colour for the same role. Leave out defaults.
<!-- /drawing-core -->

## Elements
Types: rectangle, ellipse, diamond, text, arrow, line. Give each shape a short `id`; x,y,width,height are pixels (size grows to fit the label).
`{"type":"rectangle","id":"a","x":0,"y":0,"width":160,"height":70,"backgroundColor":"input","label":{"text":"Browser"}}`
`{"type":"arrow","id":"a1","x":160,"y":35,"points":[[0,0],[100,0]],"start":"a","end":"b","label":{"text":"HTTP"}}`
Arrow labels: 12 characters or less. Standalone `text` only for titles and notes (x is its left edge).

## Colours (names or hex)
Fill (`backgroundColor`): input/source light-blue, success/output light-green, warning/pending/external light-orange, processing/middleware light-purple, error/critical light-red, note/decision light-yellow, storage/data light-teal, analytics light-pink.
Stroke (`strokeColor`): blue, amber, green, red, purple, pink, cyan, lime. Default stroke is dark: skip it.
Zones: `backgroundColor` zone-blue (UI), zone-purple (logic), zone-green (data), `opacity` 30, large rectangle drawn first; its `label` becomes a title at its top.

## Layout
- Flow left to right or top to bottom; 40+ px between boxes, 60+ between layers.
- Use width max(160, 12 x characters); height 60, or 80 for two lines.
- Avoid arrows crossing; for a cross-zone link, route round with `points`.
- Prefer few large elements over many small ones.

## Example
[{"type":"rectangle","id":"z","x":0,"y":0,"width":620,"height":160,"backgroundColor":"zone-blue","opacity":30,"label":{"text":"Frontend","fontSize":20}},
{"type":"rectangle","id":"a","x":30,"y":60,"width":160,"height":70,"backgroundColor":"input","label":{"text":"Browser"}},
{"type":"rectangle","id":"b","x":420,"y":60,"width":160,"height":70,"backgroundColor":"processing","label":{"text":"API"}},
{"type":"arrow","id":"a1","x":190,"y":95,"points":[[0,0],[230,0]],"start":"a","end":"b","label":{"text":"HTTP"}}]
