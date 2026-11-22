---
when: \b(move|colou?r|red|blue|green|yellow|bigger|smaller|resize|rename|delete|remove|align|restyle|style|font|bold|dashed|arrow|connect|label)\b
---
## Changing elements (`vd edit`)
`{"ops":[ ... ]}` with ops applied in order:
- {"op":"move","id":"<id>","x":0,"y":0}
- {"op":"restyle","id":"<id>","strokeColor":"#e03131"} (style keys: strokeColor, backgroundColor (hex or transparent), strokeWidth, opacity 0-100, strokeStyle solid|dashed|dotted, fillStyle hachure|cross-hatch|solid|zigzag, roundness sharp|round, fontSize, angle; also text, width, height)
- {"op":"delete","id":"<id>"}
- {"op":"add","type":"rectangle|ellipse|diamond|text|arrow|line","x":0,"y":0,"width":140,"height":70,"text":"label","ref":"a"} and {"op":"add","type":"arrow","from":"a","to":"<id or ref>"}
Use `vd edit` for small changes to what exists. For new explanations or a rebuilt diagram, use the content blocks instead: the app lays those out.
