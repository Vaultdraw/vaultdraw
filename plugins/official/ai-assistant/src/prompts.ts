/**
 * What is sent: the handbook's instructions (handbook.ts) and the user message, which is the
 * request followed by what the assistant can see (the drawing summary or the open note).
 */
export { systemPrompt } from "./handbook";

/** The user message: the request, then the context when there is one. */
export function userMessage(request: string, context: string): string {
  const ask = request.trim();
  return context
    ? `${ask}\n\n---\nWhat you can see now:\n${context}`
    : ask;
}
