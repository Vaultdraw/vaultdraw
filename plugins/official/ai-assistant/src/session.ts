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
import { SYSTEM, TASK_TITLES, userMessage, type Task } from "./prompts";
import {
  buildRequest,
  createParser,
  DEFAULT_MODEL,
  errorMessageOf,
  isProvider,
  needsKey,
  ProviderError,
  providerDef,
  PROVIDERS,
  providerLabel,
  secretNameOf,
  transcript,
  type ChatMessage,
  type ProviderConfig,
  type ProviderId,
} from "./providers";

import type { CliToolStatus, PluginContext } from "@vaultdraw/api";

/** What the question is built from: chosen in the panel, default from the `context` setting. */
export type ContextMode = "auto" | "drawing" | "selection" | "none";

/** One message in the thread. */
export interface Turn {
  id: number;
  role: "user" | "assistant";
  text: string;
  task: Task;
  /** An assistant turn that ended in an error shows it in the thread. */
  error?: string;
  /** A proposed change; `outcome` is set once it was kept or discarded. */
  proposal?: Proposal;
  outcome?: string;
}

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
  /** The conversation shown in the panel, oldest first. */
  turns: readonly Turn[];
  /** The command lines found on this computer (null until looked for). */
  tools: readonly CliToolStatus[] | null;
  /** True while the login check of the tools runs. */
  checking: boolean;
  /** "chat" or the settings view of the panel. */
  view: "chat" | "settings";
  contextMode: ContextMode;
  /** The provider the panel uses now (the `provider` setting, with "auto" resolved). */
  provider: ProviderId;
  /** Whether a key is stored, per provider that takes one. */
  keys: Readonly<Record<string, boolean>>;
  /** Bumped by "AI: Choose model" so the panel opens the model picker. */
  menu: { tick: number };
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
  copyAnswer(text?: string): Promise<void>;
  /** Draws the Mermaid in the current answer. */
  draw(): Promise<void>;
  /** Applies the proposed change (one undo step), or creates the new drawing. */
  keep(): Promise<void>;
  /** Drops the proposed change; nothing was written. */
  discard(): void;
  config(): ProviderConfig;
  /** A command picked a task: select it and focus the box. */
  setTask(task: Task, target?: "request" | "key"): void;
  /** Chooses provider and model together (the model picker). */
  setModel(provider: ProviderId | "auto", model: string): Promise<void>;
  setEffort(effort: string): Promise<void>;
  /** Steps through the reasoning levels of the provider, ending with "default". */
  cycleEffort(): Promise<void>;
  /** Chooses what is sent; `persist` also makes it the default (the `context` setting). */
  setContextMode(mode: ContextMode, persist?: boolean): void;
  /** The `provider` setting as stored: a provider id or "auto". */
  rawProvider(): string;
  setView(view: "chat" | "settings"): void;
  /** Asks the panel to open its model picker. */
  openModelPicker(): void;
  /** Looks for the command lines; `check` also asks each whether it is logged in (runs them). */
  detect(check?: boolean): Promise<void>;
  /** Looks up which providers have a stored key. */
  refreshKeys(): Promise<void>;
  setKeyFor(provider: ProviderId, value: string): Promise<void>;
  removeKeyFor(provider: ProviderId): Promise<void>;
}

const isContextMode = (v: unknown): v is ContextMode =>
  v === "auto" || v === "drawing" || v === "selection" || v === "none";

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
    turns: [],
    tools: null,
    checking: false,
    view: "chat",
    contextMode: "auto",
    provider: "anthropic",
    keys: {},
    menu: { tick: 0 },
  };
  {
    const m = ctx.settings.get<string>("context");
    if (isContextMode(m)) {
      state = { ...state, contextMode: m };
    }
  }
  let turnId = 0;
  let tools: readonly CliToolStatus[] | null = null;

  /** "auto" is the first command line found (Claude, then Codex), else Anthropic with a key. */
  const providerNow = (): ProviderId => {
    const raw = ctx.settings.get<string>("provider");
    if (isProvider(raw)) {
      return raw;
    }
    const ready = (id: string) => tools?.some((t) => t.id === id && t.path);
    return ready("claude")
      ? "claude-cli"
      : ready("codex")
      ? "codex-cli"
      : "anthropic";
  };
  const config = (): ProviderConfig => {
    const provider = providerNow();
    return {
      provider,
      model: ctx.settings.get<string>("model") || DEFAULT_MODEL[provider],
      effort: ctx.settings.get<string>("effort") ?? "",
      baseUrl: ctx.settings.get<string>("base_url") ?? "",
      timeoutMs:
        Math.max(5, ctx.settings.get<number>("timeout_s") || 60) * 1000,
      hasKey,
    };
  };
  const viaOf = (c: ProviderConfig) =>
    `${providerLabel(c.provider)}${c.model ? `, ${c.model}` : ""}`;

  const refreshKey = async () => {
    hasKey = await ctx.secret.has(secretNameOf(config()));
    set({ hasKey, via: viaOf(config()), provider: config().provider });
  };
  // switching the provider or the address switches the key too
  for (const key of ["provider", "base_url", "model", "effort"]) {
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
    const mode =
      task === "ask" || task === "describe" ? state.contextMode : "auto";
    if (mode === "none") {
      return {
        text: "",
        summary: "Nothing from the drawing",
        cut: 0,
        none: true,
      };
    }
    const picked = pickElements(all, ctx.scene.selection());
    const { elements, scope } =
      mode === "drawing"
        ? { elements: all, scope: "drawing" as const }
        : mode === "selection"
        ? picked.scope === "selection"
          ? picked
          : { elements: [], scope: "selection" as const }
        : picked;
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

  /** Opens the answer stream of the chosen provider: a command line, or an HTTP request. */
  async function openAnswer(
    cfg: ProviderConfig,
    system: string,
    messages: readonly ChatMessage[],
    signal: AbortSignal,
  ): Promise<{ body: AsyncIterable<Uint8Array>; close(): void }> {
    const def = providerDef(cfg.provider);
    if (def.kind === "cli") {
      const run = await ctx.cli.run(
        {
          tool: def.tool!,
          model: cfg.model || undefined,
          effort: cfg.effort || undefined,
          system,
          prompt: transcript(messages),
          timeoutMs: Math.max(cfg.timeoutMs, 300_000),
        },
        { signal },
      );
      return run;
    }
    const res = await ctx.net.request(buildRequest(cfg, system, messages), {
      signal,
    });
    if (!res.ok) {
      throw new StatusError(res.status, errorMessageOf(await res.text()));
    }
    return res;
  }

  async function run(task: Task, request: string) {
    if (state.status === "running") {
      return;
    }
    state = {
      ...state,
      proposal: null,
      kept: null,
      // a proposal still waiting is dropped by a new question
      turns: state.proposal
        ? withOutcome(state.turns, state.proposal, "Not applied.")
        : state.turns,
    };
    await detect(false);
    // the key belongs to the provider and address chosen now (toimprove 272)
    hasKey = await ctx.secret.has(secretNameOf(config()));
    const cfg = config();
    const via = viaOf(cfg);
    const { context, sent } = await preview(task, request);
    const refuse = (error: string) =>
      set({
        task,
        request,
        context,
        sent,
        answer: "",
        error,
        via,
        provider: cfg.provider,
        drawn: null,
      });
    if (task === "describe" && ctx.scene.selection().length === 0) {
      return refuse(
        "Select something in the drawing first, then run this again.",
      );
    }
    if (
      (task === "describe" || task === "ask" || task === "summarise") &&
      !context?.text &&
      !context?.none
    ) {
      return refuse(
        context?.emptyMessage ??
          (state.contextMode === "selection" && task !== "summarise"
            ? "Select something in the drawing first, or choose another context."
            : "The drawing is empty, so there is nothing to ask about."),
      );
    }
    if (context?.none && !request.trim()) {
      return refuse("Type a question first.");
    }
    if ((task === "edit" || task === "create") && !request.trim()) {
      return refuse(
        task === "edit"
          ? "Say what to change in the drawing."
          : "Say what the new drawing should show.",
      );
    }
    if (task === "edit" && ctx.scene.path() === null) {
      return refuse('Open a drawing first, or use "New drawing" to make one.');
    }
    if (task === "diagram" && !request.trim()) {
      return refuse("Say what the diagram should show.");
    }
    if (needsKey(cfg) && !hasKey) {
      return refuse(friendlyError({ code: "SECRET_MISSING" }, cfg.provider));
    }
    const prior = task === "ask" && state.task === "ask" ? state.history : [];
    const messages: ChatMessage[] = [...prior, { role: "user", content: sent }];
    controller = new AbortController();
    const shown =
      request.trim() ||
      (task === "describe"
        ? "Describe the selection"
        : task === "summarise"
        ? "Summarise this"
        : TASK_TITLES[task]);
    set({
      status: "running",
      task,
      request,
      context,
      sent,
      answer: "",
      error: null,
      via,
      provider: cfg.provider,
      drawn: null,
      turns: [
        ...state.turns,
        { id: ++turnId, role: "user", text: shown, task },
      ],
    });
    let answer = "";
    try {
      const res = await openAnswer(
        cfg,
        SYSTEM[task],
        messages,
        controller.signal,
      );
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
      if (!answer.trim()) {
        throw new ProviderError("The answer was empty");
      }
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
          set({
            status: "idle",
            history,
            proposal,
            turns: [
              ...state.turns,
              { id: ++turnId, role: "assistant", text: "", task, proposal },
            ],
          });
          // The first shape the plan touches is selected, so the change shows on the canvas too.
          if (proposal.touched[0]) {
            ctx.scene.scrollTo(proposal.touched[0]);
          }
        } catch (err) {
          const message = (err as Error).message;
          set({
            status: "idle",
            history,
            error: message,
            turns: [
              ...state.turns,
              {
                id: ++turnId,
                role: "assistant",
                text: "",
                task,
                error: message,
              },
            ],
          });
        }
      } else {
        set({
          status: "idle",
          history,
          turns: [
            ...state.turns,
            { id: ++turnId, role: "assistant", text: answer, task },
          ],
        });
      }
    } catch (err) {
      const stopped = (err as { code?: string }).code === "ABORTED";
      const message = stopped
        ? null
        : err instanceof StatusError
        ? statusMessage(cfg.provider, err.status, err.detail)
        : friendlyError(err, cfg.provider);
      // what streamed before a stop or a failure stays in the thread
      set({
        status: "idle",
        error: message,
        turns: answer.trim()
          ? [
              ...state.turns,
              { id: ++turnId, role: "assistant", text: answer, task },
            ]
          : state.turns,
      });
    } finally {
      controller = null;
    }
  }

  /** The name a provider's key is stored under (the address setting belongs to the chosen provider). */
  const keyName = (p: ProviderId) =>
    secretNameOf({
      ...config(),
      provider: p,
      baseUrl: p === config().provider ? config().baseUrl : "",
    });
  const keyProviders = () => PROVIDERS.filter((p) => p.needsKey);
  async function refreshKeys() {
    const keys: Record<string, boolean> = {};
    for (const p of keyProviders()) {
      keys[p.id] = await ctx.secret.has(keyName(p.id));
    }
    set({ keys });
  }

  /** Finds the command lines (no process starts unless `check`: then each reports its login). */
  async function detect(check: boolean) {
    if (!check && tools) {
      return;
    }
    if (check) {
      set({ checking: true });
    }
    try {
      tools = await ctx.cli.detect({ check });
    } catch {
      tools = tools ?? [];
    }
    set({
      tools,
      checking: false,
      provider: config().provider,
      via: viaOf(config()),
    });
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
        turns: [],
        view: "chat",
      });
    },
    refreshKey,
    async setKey(value) {
      await ctx.secret.set(secretNameOf(config()), value.trim());
      hasKey = true;
      set({ hasKey, error: null });
    },
    async copyAnswer(text) {
      try {
        await navigator.clipboard.writeText(text ?? state.answer);
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
      const was = state.proposal;
      set({
        proposal: null,
        kept: null,
        answer: "",
        turns: was ? withOutcome(state.turns, was, "Discarded.") : state.turns,
      });
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
          const kept = `Applied: ${p.headline}. Undo with ${undo}+Z.`;
          set({
            proposal: null,
            error: null,
            kept,
            turns: withOutcome(state.turns, p, kept),
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
          const kept = `Created "${made}": ${p.headline}.`;
          set({
            proposal: null,
            error: null,
            kept,
            turns: withOutcome(state.turns, p, kept),
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
      set({
        task,
        view: target === "key" ? "settings" : "chat",
        focus: { tick: state.focus.tick + 1, target },
      });
    },
    async setModel(provider, model) {
      await ctx.settings.set("provider", provider);
      await ctx.settings.set("model", model);
      // an effort the new provider does not know would be refused
      const efforts = provider === "auto" ? [] : providerDef(provider).efforts;
      if (!efforts.includes(ctx.settings.get<string>("effort") ?? "")) {
        await ctx.settings.set("effort", "");
      }
      await refreshKey();
    },
    async setEffort(effort) {
      await ctx.settings.set("effort", effort);
      set({ via: viaOf(config()) });
    },
    async cycleEffort() {
      const levels = ["", ...providerDef(config().provider).efforts];
      if (levels.length === 1) {
        ctx.ui.toast("This provider has no reasoning levels");
        return;
      }
      const i = levels.indexOf(config().effort);
      const next = levels[(i + 1) % levels.length];
      await ctx.settings.set("effort", next);
      ctx.ui.toast(`Reasoning: ${next || "default"}`);
    },
    setContextMode(mode, persist = false) {
      set({ contextMode: mode });
      if (persist) {
        void ctx.settings.set("context", mode);
      }
    },
    rawProvider: () => ctx.settings.get<string>("provider") ?? "auto",
    setView(view) {
      set({ view });
    },
    openModelPicker() {
      set({ view: "chat", menu: { tick: state.menu.tick + 1 } });
    },
    detect,
    refreshKeys,
    async setKeyFor(provider, value) {
      await ctx.secret.set(keyName(provider), value.trim());
      await refreshKeys();
      await refreshKey();
    },
    async removeKeyFor(provider) {
      await ctx.secret.delete(keyName(provider));
      await refreshKeys();
      await refreshKey();
    },
  };
}

function withOutcome(
  turns: readonly Turn[],
  proposal: Proposal,
  outcome: string,
): Turn[] {
  return turns.map((t) => (t.proposal === proposal ? { ...t, outcome } : t));
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
