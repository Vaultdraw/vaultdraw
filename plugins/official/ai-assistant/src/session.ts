/**
 * The assistant's state and the one request it runs at a time. The panel reads it with
 * `useSyncExternalStore`; commands call `run`, `cancel` and `clear`.
 */
import {
  pickElements,
  describeElements,
  noteName,
  noteText,
  textOf,
  type Context,
} from "./context";
import { insertDiagram } from "./diagram";
import {
  buildProposal,
  describeForEdit,
  drawingName,
  stillValid,
  type Proposal,
} from "./edits";
import { friendlyError, statusMessage } from "./errors";
import { SYSTEM, userMessage, type Task } from "./prompts";
import {
  buildRequest,
  createParser,
  DEFAULT_MODEL,
  errorMessageOf,
  isProvider,
  needsKey,
  secretNameOf,
  type ChatMessage,
  type ProviderConfig,
} from "./providers";

import type { PluginContext } from "@vaultdraw/api";

export interface SessionState {
  status: "idle" | "running";
  task: Task;
  /** What the user asked (shown above the answer). */
  request: string;
  /** What is sent besides the request: shown before and after sending. */
  context: Context | null;
  /** The whole message sent as the user turn, for the "What is sent" view. */
  sent: string;
  answer: string;
  error: string | null;
  /** The earlier turns of an `ask` conversation. */
  history: readonly ChatMessage[];
  hasKey: boolean;
  /** One line about the provider and model, e.g. "Anthropic, claude-sonnet-4-5". */
  via: string;
  /** Set after a diagram answer: the number of shapes drawn, or null. */
  drawn: number | null;
  /** A change the model proposed, shown but not applied until Keep. */
  proposal: Proposal | null;
  /** What Keep did, in plain words (cleared by the next request). */
  kept: string | null;
  /** Bumped by commands so the panel puts the cursor in the question box (or the key box). */
  focus: { tick: number; target: "request" | "key" };
}

export interface Session {
  get(): SessionState;
  subscribe(cb: () => void): () => void;
  /** Builds what would be sent for `task` (no request). */
  preview(
    task: Task,
    request: string,
  ): Promise<{ context: Context | null; sent: string }>;
  run(task: Task, request: string): Promise<void>;
  cancel(): void;
  clear(): void;
  refreshKey(): Promise<void>;
  setKey(value: string): Promise<void>;
  removeKey(): Promise<void>;
  /** Copies the current answer and says whether it worked. */
  copyAnswer(): Promise<void>;
  /** Draws the Mermaid in the current answer. */
  draw(): Promise<void>;
  /** Applies the proposed change (one undo step), or creates the new drawing. */
  keep(): Promise<void>;
  /** Drops the proposed change; nothing was written. */
  discard(): void;
  config(): ProviderConfig;
  /** A command picked a task: select it and focus the box. */
  setTask(task: Task, target?: "request" | "key"): void;
}

const PROVIDER_NAMES = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  ollama: "Ollama",
} as const;

export function createSession(ctx: PluginContext): Session {
  let controller: AbortController | null = null;
  let hasKey = false;
  const listeners = new Set<() => void>();
  let state: SessionState = {
    status: "idle",
    task: "ask",
    request: "",
    context: null,
    sent: "",
    answer: "",
    error: null,
    history: [],
    hasKey: false,
    via: "",
    drawn: null,
    proposal: null,
    kept: null,
    focus: { tick: 0, target: "request" },
  };

  const config = (): ProviderConfig => {
    const raw = ctx.settings.get<string>("provider");
    const provider = isProvider(raw) ? raw : "anthropic";
    return {
      provider,
      model: ctx.settings.get<string>("model") || DEFAULT_MODEL[provider],
      baseUrl: ctx.settings.get<string>("base_url") ?? "",
      timeoutMs:
        Math.max(5, ctx.settings.get<number>("timeout_s") || 60) * 1000,
      hasKey,
    };
  };
  const viaOf = (c: ProviderConfig) =>
    `${PROVIDER_NAMES[c.provider]}, ${c.model}`;

  const refreshKey = async () => {
    hasKey = await ctx.secret.has(secretNameOf(config()));
    set({ hasKey, via: viaOf(config()) });
  };
  // switching the provider or the address switches the key too
  for (const key of ["provider", "base_url"]) {
    ctx.subscriptions.push(
      ctx.settings.onChange(key, () => {
        void refreshKey();
      }),
    );
  }

  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    for (const cb of [...listeners]) {
      cb();
    }
  };

  const limit = () =>
    Math.max(500, ctx.settings.get<number>("max_context_chars") || 12000);

  async function contextFor(task: Task): Promise<Context | null> {
    if (task === "diagram") {
      return null;
    }
    if (task === "create") {
      return null;
    }
    if (task === "edit") {
      const all = ctx.scene.elements();
      const d = describeForEdit(all, ctx.scene.selection(), limit());
      return {
        text: d.text,
        cut: d.cut,
        summary: `The whole drawing: ${d.summary}`,
      };
    }
    if (task === "summarise") {
      // A note in the active tab is summarised as it is on disk; a drawing by its text.
      const notePath = ctx.workspace.activeNotePath();
      if (notePath) {
        const name = noteName(notePath);
        try {
          const note = await ctx.vault.readNote(notePath);
          return noteText(note.text, name, limit());
        } catch (err) {
          return {
            text: "",
            summary: `Note "${name}"`,
            cut: 0,
            emptyMessage: `Could not read this note (${
              err instanceof Error ? err.message : "unknown problem"
            }). Save it and try again.`,
          };
        }
      }
    }
    const all = ctx.scene.elements();
    const { elements, scope } = pickElements(all, ctx.scene.selection());
    if (task === "summarise") {
      const c = textOf(elements, limit());
      return {
        ...c,
        summary: `${
          scope === "selection" ? "Selected text" : "Text of this drawing"
        }: ${c.summary}`,
      };
    }
    const c = describeElements(elements, limit());
    return {
      ...c,
      summary: `${
        scope === "selection" ? "The selection" : "The whole drawing"
      }: ${c.summary}`,
    };
  }

  async function preview(task: Task, request: string) {
    const context = await contextFor(task);
    return { context, sent: userMessage(task, request, context?.text ?? "") };
  }

  async function run(task: Task, request: string) {
    if (state.status === "running") {
      return;
    }
    state = { ...state, proposal: null, kept: null };
    // the key belongs to the provider and address chosen now (toimprove 272)
    hasKey = await ctx.secret.has(secretNameOf(config()));
    const cfg = config();
    const via = viaOf(cfg);
    const { context, sent } = await preview(task, request);
    if (task === "describe" && ctx.scene.selection().length === 0) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error: "Select something in the drawing first, then run this again.",
        via,
        drawn: null,
      });
      return;
    }
    if (
      (task === "describe" || task === "ask" || task === "summarise") &&
      !context?.text
    ) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error:
          context?.emptyMessage ??
          "The drawing is empty, so there is nothing to ask about.",
        via,
        drawn: null,
      });
      return;
    }
    if ((task === "edit" || task === "create") && !request.trim()) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error:
          task === "edit"
            ? "Say what to change in the drawing."
            : "Say what the new drawing should show.",
        via,
        drawn: null,
      });
      return;
    }
    if (task === "edit" && ctx.scene.path() === null) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error: 'Open a drawing first, or use "New drawing" to make one.',
        via,
        drawn: null,
      });
      return;
    }
    if (task === "diagram" && !request.trim()) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error: "Say what the diagram should show.",
        via,
        drawn: null,
      });
      return;
    }
    if (needsKey(cfg) && !hasKey) {
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error: friendlyError({ code: "SECRET_MISSING" }, cfg.provider),
        via,
        drawn: null,
      });
      return;
    }
    const prior = task === "ask" && state.task === "ask" ? state.history : [];
    const messages: ChatMessage[] = [...prior, { role: "user", content: sent }];
    controller = new AbortController();
    set({
      status: "running",
      task,
      request,
      context,
      sent,
      answer: "",
      error: null,
      via,
      drawn: null,
    });
    let answer = "";
    try {
      const res = await ctx.net.request(
        buildRequest(cfg, SYSTEM[task], messages),
        { signal: controller.signal },
      );
      if (!res.ok) {
        throw new StatusError(res.status, errorMessageOf(await res.text()));
      }
      const parser = createParser(cfg.provider);
      const dec = new TextDecoder();
      const add = (parts: string[]) => {
        if (parts.length) {
          answer += parts.join("");
          set({ answer });
        }
      };
      for await (const chunk of res.body) {
        add(parser.push(dec.decode(chunk, { stream: true })));
        if (parser.done) {
          break;
        }
      }
      add(parser.push(dec.decode()));
      add(parser.end());
      res.close();
      const history =
        task === "ask"
          ? [...messages, { role: "assistant" as const, content: answer }]
          : [];
      if (task === "edit" || task === "create") {
        try {
          const proposal = buildProposal(
            answer,
            task,
            ctx.scene.elements(),
            task === "edit" ? ctx.scene.path() : null,
            Math.max(1, ctx.settings.get<number>("edit_max_ops") || 60),
          );
          set({ status: "idle", history, proposal });
          // The first shape the plan touches is selected, so the change shows on the canvas too.
          if (proposal.touched[0]) {
            ctx.scene.scrollTo(proposal.touched[0]);
          }
        } catch (err) {
          set({ status: "idle", history, error: (err as Error).message });
        }
      } else {
        set({ status: "idle", history });
      }
    } catch (err) {
      const stopped = (err as { code?: string }).code === "ABORTED";
      set({
        status: "idle",
        error: stopped
          ? null
          : err instanceof StatusError
          ? statusMessage(cfg.provider, err.status, err.detail)
          : friendlyError(err, cfg.provider),
      });
    } finally {
      controller = null;
    }
  }

  return {
    get: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    preview,
    run,
    cancel() {
      controller?.abort();
    },
    clear() {
      controller?.abort();
      set({
        status: "idle",
        request: "",
        context: null,
        sent: "",
        answer: "",
        error: null,
        history: [],
        drawn: null,
        proposal: null,
        kept: null,
      });
    },
    refreshKey,
    async setKey(value) {
      await ctx.secret.set(secretNameOf(config()), value.trim());
      hasKey = true;
      set({ hasKey, error: null });
    },
    async copyAnswer() {
      try {
        await navigator.clipboard.writeText(state.answer);
        ctx.ui.toast("Copied the answer");
      } catch {
        ctx.ui.toast("Could not copy the answer", { kind: "error" });
      }
    },
    async removeKey() {
      await ctx.secret.delete(secretNameOf(config()));
      hasKey = false;
      set({ hasKey });
    },
    discard() {
      set({ proposal: null, kept: null, answer: "" });
    },
    async keep() {
      const p = state.proposal;
      if (!p) {
        ctx.ui.toast("There is no proposed change to keep");
        return;
      }
      const undo = /mac/i.test(navigator.platform) ? "Cmd" : "Ctrl";
      try {
        if (p.kind === "edit") {
          if (!stillValid(p, ctx.scene.elements(), ctx.scene.path())) {
            set({
              proposal: null,
              error:
                "The drawing changed since this was proposed, so nothing was applied. Ask again.",
            });
            return;
          }
          await ctx.scene.batch(p.ops, { path: p.path ?? undefined });
          set({
            proposal: null,
            error: null,
            kept: `Applied: ${p.headline}. Undo with ${undo}+Z.`,
          });
        } else {
          const folder = (
            ctx.settings.get<string>("create_folder") || ""
          ).replace(/^\/+|\/+$/g, "");
          const base = drawingName(p.title);
          let made: string | null = null;
          for (let n = 1; n <= 50 && !made; n++) {
            const name = `${base}${n === 1 ? "" : ` ${n}`}.excalidraw`;
            const path = folder ? `${folder}/${name}` : name;
            try {
              await ctx.vault.createDrawing(path, p.ops);
              made = path;
            } catch (err) {
              if ((err as { code?: string }).code !== "NAME_COLLISION") {
                throw err;
              }
            }
          }
          if (!made) {
            throw new Error("Could not find a free name for the new drawing.");
          }
          await ctx.workspace.open(made);
          set({
            proposal: null,
            error: null,
            kept: `Created "${made}": ${p.headline}.`,
          });
        }
      } catch (err) {
        set({ error: editError(err) });
      }
    },
    async draw() {
      try {
        const n = await insertDiagram(ctx, state.answer);
        set({ drawn: n, error: null });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    },
    config,
    setTask(task, target = "request") {
      set({ task, focus: { tick: state.focus.tick + 1, target } });
    },
  };
}

function editError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case "DRAWING_CHANGED":
      return "You switched to another drawing, so nothing was applied. Open the drawing and ask again.";
    case "READ_ONLY":
      return "This drawing or vault is read-only, so nothing was changed.";
    case "NOT_FOUND":
      return "No drawing is open, so there is nothing to change.";
    case "PERMISSION":
      return "The AI assistant needs permission to write drawings. Turn it off and on again in Settings, Plugins.";
    case "INVALID_ARGUMENT":
      return "The app could not apply part of the plan, so nothing was changed. Ask again, in other words.";
    case "TOO_LARGE":
      return "The drawing would become too large, so nothing was changed.";
    default:
      return `Could not apply the change: ${
        err instanceof Error ? err.message : "unknown problem"
      }`;
  }
}

class StatusError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`status ${status}`);
  }
}
