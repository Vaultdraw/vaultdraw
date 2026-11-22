---
when: \b(improve|better|clearer|clarify|descriptive|illustrative|in[- ]depth|more detail\w*|restructure|rework|redo|redraw|rebuild|fix (the|this) diagram|tidy|clean ?up|make (it|this) (more|less)|confusing|messy)\b
---
## Recipe: improve a diagram
The user wants the content to explain more, not new colours.
1. Read the diagram from the summary: its boxes, texts and what the arrows connect. Work out what it is trying to explain.
2. Rewrite it as Mermaid of the right type (checklist): every arrow labelled with what it carries, steps numbered, full node labels, notes for concepts a newcomer would miss. Add missing steps a reader needs.
3. One `vd diagram` with `replace=selection` when something is selected, else `replace=all` when the drawing is only that diagram, else the ids of its elements. Give `title=` and `caption=`.
4. When the concept needs it, add after the diagram a `vd note` with the key terms or the "why".
In the chat, list in two or three lines what you changed and why. If the user says nothing changed, look at your previous reply: if it had no blocks or only restyled, rebuild the diagram now.
