/** Plain-words messages for what can go wrong: no codes, no jargon, one next step. */
import { ProviderError, providerDef } from "./providers";

import type { ProviderId } from "./providers";

const nameOf = (id: ProviderId) => providerDef(id).label;
const isCli = (id: ProviderId) => providerDef(id).kind === "cli";
const LOGIN_HINT: Partial<Record<ProviderId, string>> = {
  "claude-cli":
    "Run claude in a terminal once and sign in, or open Settings in this panel.",
  "codex-cli": "Run codex login in a terminal, or open Settings in this panel.",
};

/** The message for an answer with a status outside 200 to 299. `detail` is the provider's own text. */
export function statusMessage(
  provider: ProviderId,
  status: number,
  detail: string,
): string {
  const name = nameOf(provider);
  const extra = detail ? ` ${name} says: ${detail}` : "";
  if (status === 401 || status === 403) {
    return `${name} did not accept the key. Check it with "AI: Set API key".${extra}`;
  }
  if (status === 404) {
    return provider === "ollama"
      ? `Ollama does not have that model. Pull it first, or change the model in the AI settings.${extra}`
      : `${name} does not know that model or address. Check the model and address in the AI settings.${extra}`;
  }
  if (status === 408 || status === 504) {
    return `${name} took too long to answer. Try again, or raise the timeout in the AI settings.`;
  }
  if (status === 429) {
    return `${name} says there have been too many requests, or the quota is used up. Wait a moment and try again.${extra}`;
  }
  if (status >= 500) {
    return `${name} has a problem on its side (status ${status}). Try again in a moment.${extra}`;
  }
  return `${name} refused the request (status ${status}).${extra}`;
}

/** The message for any thrown error. */
export function friendlyError(err: unknown, provider: ProviderId): string {
  const name = nameOf(provider);
  if (err instanceof ProviderError) {
    if (
      isCli(provider) &&
      /log ?in|auth|credential|sign ?in|401/i.test(err.message)
    ) {
      return `${name} is not signed in. ${LOGIN_HINT[provider] ?? ""}`.trim();
    }
    return `${name} reported a problem: ${err.message}`;
  }
  const code = (err as { code?: string } | null)?.code;
  const message = (err as Error | null)?.message ?? String(err);
  switch (code) {
    case "NETWORK_DISABLED":
      return isCli(provider)
        ? `Offline mode is on, so nothing was sent: ${name} needs the internet. Turn Offline mode off in Settings, or use a model on this computer (Ollama).`
        : "Offline mode is on, so nothing was sent. Turn Offline mode off in Settings, or use a model on this computer (Ollama).";
    case "NETWORK_NOT_ALLOWED":
      return "AI requests are turned off by network.allow_ai in your config file. Remove it or set it to true.";
    case "CLI_NOT_FOUND":
      return `${name} is not installed on this computer. Install it, or pick another model in the panel.`;
    case "CLI_FAILED":
      return /log ?in|auth|credential|sign ?in|401/i.test(message)
        ? `${name} is not signed in. ${LOGIN_HINT[provider] ?? ""}`.trim()
        : `${name} stopped with an error: ${message}`;
    case "SECRET_MISSING":
      return `No API key is saved. Use "AI: Set API key" to add one.`;
    case "NETWORK_TIMEOUT":
      return `${name} did not answer in time. Try again, or raise the timeout in the AI settings.`;
    case "PRIVATE_ADDRESS":
      return `That address is on your own network, which is off limits unless you allow it. Add it to network.allow_private_hosts in your config file, for example ["192.168.1.20:11434"].`;
    case "INVALID_URL":
      return `That address cannot be used: ${message}`;
    case "TOO_LARGE":
      return "The answer was longer than the limit and was cut off.";
    case "ABORTED":
      return "Stopped.";
    case "NETWORK_ERROR":
      return provider === "ollama"
        ? "Could not reach Ollama. Is it running, and is its address in the AI settings right?"
        : `Could not reach ${name}. Check your connection and the address in the AI settings.`;
    case "PERMISSION":
      return "The AI assistant does not have the permission it needs. Turn it off and on again in Settings, Plugins.";
    default:
      return message;
  }
}
