/** The instructions for each task. Short on purpose: the user sees exactly what is sent. */
export type Task =
  | "ask"
  | "describe"
  | "diagram"
  | "summarise"
  | "edit"
  | "create";

export const TASK_TITLES: Record<Task, string> = {
  ask: "Ask",
  describe: "Describe the selection",
  diagram: "Generate a diagram",
  summarise: "Summarise",
  edit: "Edit this drawing",
  create: "New drawing",
};

const BASE =
  "You help someone who works in a drawing app (Excalidraw style). Answer briefly and plainly. No preamble.";

const PLAN_FORMAT = `Reply with ONE fenced json block and nothing else: {"title": "short title", "ops": [ ... ]}. Each op is one of:
{"op":"add","type":"rectangle|ellipse|diamond|text|arrow|line","x":0,"y":0,"width":140,"height":70,"text":"label","strokeColor":"#1e1e1e","backgroundColor":"#a5d8ff","ref":"a"}
{"op":"add","type":"arrow","from":"a","to":"b"}   (from and to name a ref of a shape added in this plan{ID_HINT})
Style keys you may use: strokeColor, backgroundColor (hex, or transparent), strokeWidth, opacity (0-100), strokeStyle (solid|dashed|dotted), fillStyle (hachure|cross-hatch|solid|zigzag), roundness (sharp|round), fontSize, angle. Coordinates are pixels; keep shapes about 40 apart. Use text on a shape to label it. Keep the plan small (at most 40 ops).`;

const EDIT_OPS = `{"op":"move","id":"<id>","x":0,"y":0}
{"op":"restyle","id":"<id>","strokeColor":"#e03131"}   (any style key, or text, width, height)
{"op":"delete","id":"<id>"}`;

export const SYSTEM: Record<Task, string> = {
  ask: `${BASE} The drawing is given as a list of its elements with their text and positions.`,
  describe: `${BASE} Describe what the given part of a drawing shows, in a few sentences, in plain words. The part is given as a list of elements with their text and positions.`,
  diagram: `${BASE} Turn the request into a Mermaid diagram. Reply with ONE fenced code block marked mermaid and nothing else. Use only flowchart, sequence, class, state or ER syntax. Keep node labels short.`,
  edit: `${BASE} You change the open drawing. The drawing is given as a list of elements, each with its id; [selected] marks what the user selected. Only use ids from the list. ${PLAN_FORMAT.replace(
    "{ID_HINT}",
    ", or the id of an existing shape",
  )}\n${EDIT_OPS}`,
  create: `${BASE} You make a new drawing from the request. ${PLAN_FORMAT.replace(
    "{ID_HINT}",
    "",
  )}`,
  summarise: `${BASE} Summarise the text. Use a short paragraph, then at most five bullet points for the key facts. Do not add facts that are not in the text.`,
};

/** The user message for a task: the request, then the context when there is one. */
export function userMessage(
  task: Task,
  request: string,
  context: string,
): string {
  const ask = request.trim();
  if (task === "diagram" || task === "create") {
    return ask;
  }
  const head =
    task === "edit"
      ? `Change the drawing as asked: ${ask}`
      : task === "describe"
      ? "Describe this."
      : task === "summarise"
      ? "Summarise this."
      : ask;
  return context ? `${head}\n\n---\n${context}` : head;
}
