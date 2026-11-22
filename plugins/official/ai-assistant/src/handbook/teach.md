---
when: \b(teach|explain|learn|understand|lesson|tutorial|course|guide|overview|introduc\w*|how (do|does|did|is|are|can)|what (is|are)|why (do|does|is|are)|walk me through|pointers|readme|concept|in[- ]depth|deep dive|study)\b
---
## Recipe: teach a topic
Build the whole page in one reply; don't ask what to include. In the chat, say in one or two lines what the page covers.
1. `vd heading level=1`: the topic as a question or promise ("How the internet moves your data").
2. `vd text`: one or two lines: what it is and why it matters.
3. Three to six sections, each: `vd heading level=2`, then `vd text` with 3-6 pointers (a pointer = one fact or step, starting with the key word), then a `vd diagram` when the idea has parts, steps or flow (checklist applies).
4. `vd note`: a concrete example from everyday life or real numbers.
5. `vd note`: key terms, one line each ("Packet: a small piece of a message, with an address").
6. `vd text`: a three-line summary. Offer, in the chat, to go deeper on any section or to add three quiz questions.
For a big topic, cover the essentials first and say what could come next.
