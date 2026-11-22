---
when: \b(page|pages|paper|lined|ruled|grid|dots|dotted|squared|isometric|background|landscape|portrait|a3|a4|a5|b5|letter|legal|tablet|phone|infinite canvas|orientation|old ?school)\b
---
## The drawing's settings (`vd settings`)
JSON with only the keys that change:
- pageMode: true (pages like a document) or false (the infinite canvas)
- paper: {{paper}}
- paperTheme: {{paperTheme}}
- pageSize: {{pageSize}}
- orientation: portrait or landscape
- layout: separate (pages apart) or continuous
- background: a hex colour such as "#ffffff"
