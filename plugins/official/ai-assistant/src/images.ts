/**
 * How attached images travel to each provider. The two command lines get them through the app
 * (`ctx.cli` takes the images and puts them where the tool reads them); the APIs take them inside
 * the message. Pure, so each shape is tested with plain values.
 */
import type { ChatMessage, ProviderId } from "./providers";

/** One image of a message: base64 text without the `data:` lead. */
export interface MessageImage {
  mime: string;
  data: string;
}

/** The messages as a provider's API wants them (images inside the message that carries them). */
export function wireMessages(
  provider: ProviderId,
  messages: readonly ChatMessage[],
): unknown[] {
  return messages.map((m) => {
    const images = m.images ?? [];
    if (images.length === 0) {
      return { role: m.role, content: m.content };
    }
    if (provider === "anthropic") {
      return {
        role: m.role,
        content: [
          ...images.map((i) => ({
            type: "image",
            source: { type: "base64", media_type: i.mime, data: i.data },
          })),
          { type: "text", text: m.content },
        ],
      };
    }
    if (provider === "openai") {
      return {
        role: m.role,
        content: [
          ...images.map((i) => ({
            type: "image_url",
            image_url: { url: `data:${i.mime};base64,${i.data}` },
          })),
          { type: "text", text: m.content },
        ],
      };
    }
    // ollama
    return {
      role: m.role,
      content: m.content,
      images: images.map((i) => i.data),
    };
  });
}

/** The images of the newest message, for a command line (which gets one prompt, not messages). */
export function lastImages(messages: readonly ChatMessage[]): MessageImage[] {
  return [...(messages[messages.length - 1]?.images ?? [])];
}
