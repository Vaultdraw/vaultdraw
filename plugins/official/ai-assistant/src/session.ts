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
import { ACCESS_LABEL, isAccess, nextAccess, type AccessMode } from "./access";
import { insertDiagram } from "./diagram";
import {
  buildProposal,
  describeForEdit,
  drawingName,
  NoChange,
  stillValid,
  type Proposal,
} from "./edits";
import { friendlyError, statusMessage } from "./errors";
import { lastImages } from "./images";
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

import type { MessageImage } from "./images";
import type { CliToolStatus, Json, PluginContext } from "@vaultdraw/api";

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
  /** What happened to the proposal, as one line: "Added 2 boxes", "Discarded", "Not applied". */
  outcome?: string;
  /** The proposal's headline, kept after the proposal itself is gone (a reopened chat). */
  summary?: string;
  /** True when `outcome` is the whole result line of a change that was applied. */
  applied?: boolean;
  /** The drawing an applied change can still be undone in (not kept in saved chats). */
  undoPath?: string;
  undone?: boolean;
}

/** One saved chat in the history list. */
export interface ChatSummary {
  id: string;
  title: string;
  /** Milliseconds since 1970. */
  at: number;
  provider: ProviderId;
  /** The vault it was made in. */
  vault: string;
}

/** What is stored of a chat: the turns without the proposals (ops, ghosts) and without ids. */
interface StoredTurn {
  role: Turn["role"];
  text: string;
  task: Task;
  error?: string;
  outcome?: string;
  summary?: string;
  applied?: boolean;
  undone?: boolean;
}
interface StoredChat extends ChatSummary {
  turns: StoredTurn[];
}

/** The history keeps this many chats; the oldest go first. */
export const MAX_CHATS = 50;
const INDEX_KEY = "chats";
const chatKey = (id: string) => `chat:${id}`;

const titleOf = (turns: readonly { role: string; text: string }[]) => {
  const first = turns.find((t) => t.role === "user")?.text.trim() ?? "";
  const one = first.replace(/\s+/g, " ");
  return one.length > 80 ? `${one.slice(0, 79)}…` : one || "Chat";
};

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
  /** "chat", the settings view or the list of earlier chats. */
  view: "chat" | "settings" | "history";
  contextMode: ContextMode;
  /** The provider the panel uses now (the `provider` setting, with "auto" resolved). */
  provider: ProviderId;
  /** Whether a key is stored, per provider that takes one. */
  keys: Readonly<Record<string, boolean>>;
  /** Bumped by "AI: Choose model" so the panel opens the model picker. */
  menu: { tick: number };
  /** How much the assistant may do with the drawing (the `access` setting). */
  access: AccessMode;
}

export interface Session {
  get(): SessionState;
  subscribe(cb: () => void): () => void;
  /** Builds what would be sent for `task` (no request). */
  preview(
    task: Task,
    request: string,
  ): Promise<{ context: Context | null; sent: string }>;
  /** Asks; `images` (at most the composer's limit) go with the question. */
  run(
    task: Task,
    request: string,
    images?: readonly MessageImage[],
  ): Promise<void>;
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
  setView(view: "chat" | "settings" | "history"): void;
  /** The saved chats of this vault, newest first (reads storage when called, not before). */
  chats(): Promise<ChatSummary[]>;
  /** Shows a saved chat in the panel. */
  openChat(id: string): Promise<void>;
  deleteChat(id: string): Promise<void>;
  /** Undoes the change a result card reports (the app's own undo; one step). */
  undo(turnId: number): void;
  /** Asks the panel to open its model picker. */
  openModelPicker(): void;
  /** Chooses the permission mode (the `access` setting). */
  setAccess(mode: AccessMode): Promise<void>;
  /** Steps ask first, apply at once, read only, and says which. */
  cycleAccess(): Promise<void>;
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
    access: "ask",
  };
  {
    const m = ctx.settings.get<string>("context");
    if (isContextMode(m)) {
      state = { ...state, contextMode: m };
    }
  }
  const accessNow = (): AccessMode => {
    const a = ctx.settings.get<string>("access");
    return isAccess(a) ? a : "ask";
  };
  state = { ...state, access: accessNow() };
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
  ctx.subscriptions.push(
    ctx.settings.onChange("access", () => set({ access: accessNow() })),
  );
  // switching the provider or the address switches the key too
  for (const key of ["provider", "base_url", "model", "effort"]) {
    ctx.subscriptions.push(
      ctx.settings.onChange(key, () => {
        void refreshKey();
      }),
    );
  }

  /** The saved chat the thread belongs to (made on the first save). */
  let chatId: string | null = null;
  let restoring = false;
  let saveChain: Promise<void> = Promise.resolve();

  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    for (const cb of [...listeners]) {
      cb();
    }
    // a finished step (answer, Keep, Discard, Undo) saves the chat; nothing is read or written before
    if (patch.turns && state.status === "idle" && !restoring) {
      saveChat();
    }
  };

  const storeTurn = (t: Turn): StoredTurn => ({
    role: t.role,
    text: t.text,
    task: t.task,
    ...(t.error ? { error: t.error } : {}),
    // a proposal that was never kept can't be kept again after reopening
    ...(t.proposal
      ? {
          outcome: t.outcome ?? "Not applied",
          summary: t.summary ?? t.proposal.headline,
        }
      : t.outcome
      ? { outcome: t.outcome, summary: t.summary }
      : {}),
    ...(t.applied ? { applied: true } : {}),
    ...(t.undone ? { undone: true } : {}),
  });

  /** Writes the thread as one saved chat and keeps the newest `MAX_CHATS` (storage is lazy: first write is here). */
  function saveChat() {
    const turns = state.turns;
    if (turns.length === 0) {
      return;
    }
    const id = (chatId ??= `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`);
    const rec: StoredChat = {
      id,
      title: titleOf(turns),
      at: Date.now(),
      provider: state.provider,
      vault: ctx.vault.info()?.name ?? "",
      turns: turns.map(storeTurn),
    };
    saveChain = saveChain
      .then(async () => {
        const store = ctx.storage.global;
        await store.set(chatKey(id), rec as unknown as Json);
        const list = ((await store.get<Json>(INDEX_KEY)) ??
          []) as unknown as ChatSummary[];
        const entry: ChatSummary = {
          id,
          title: rec.title,
          at: rec.at,
          provider: rec.provider,
          vault: rec.vault,
        };
        const next = [entry, ...list.filter((c) => c.id !== id)].slice(
          0,
          MAX_CHATS,
        );
        for (const gone of list.filter(
          (c) => !next.some((n) => n.id === c.id),
        )) {
          await store.delete(chatKey(gone.id));
        }
        await store.set(INDEX_KEY, next as unknown as Json);
      })
      .catch((err) => ctx.log.warn("could not save the chat", err));
  }

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
          ...(lastImages(messages).length
            ? { images: lastImages(messages) }
            : {}),
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

  async function run(
    wanted: Task,
    request: string,
    images: readonly MessageImage[] = [],
  ) {
    if (state.status === "running") {
      return;
    }
    // read only: a request to change or make a drawing is answered in words
    const task: Task =
      accessNow() === "read" && (wanted === "edit" || wanted === "create")
        ? "ask"
        : wanted;
    state = {
      ...state,
      proposal: null,
      kept: null,
      // a proposal still waiting is dropped by a new question
      turns: state.proposal
        ? withOutcome(state.turns, state.proposal, "Not applied")
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
    // pictures go with the newest message only; earlier turns keep just their words
    const messages: ChatMessage[] = [
      ...prior,
      images.length
        ? { role: "user", content: sent, images }
        : { role: "user", content: sent },
    ];
    controller = new AbortController();
    const shown =
      (request.trim() ||
        (task === "describe"
          ? "Describe the selection"
          : task === "summarise"
          ? "Summarise this"
          : TASK_TITLES[task])) +
      (images.length
        ? `${request.trim() ? "\n" : " "}+ ${images.length} image${
            images.length === 1 ? "" : "s"
          }`
        : "");
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
          ? [
              ...messages.map((m) => ({ role: m.role, content: m.content })),
              { role: "assistant" as const, content: answer },
            ]
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
              {
                id: ++turnId,
                role: "assistant",
                text: "",
                task,
                proposal,
                summary: proposal.headline,
              },
            ],
          });
          // The first shape the plan touches is selected, so the change shows on the canvas too.
          if (proposal.touched[0]) {
            ctx.scene.scrollTo(proposal.touched[0]);
          }
          // apply at once: an edit goes in as one undo step; a new drawing still asks (it is a new
          // file and the view moves to it)
          if (accessNow() === "auto" && task === "edit") {
            await session.keep();
          }
        } catch (err) {
          if (err instanceof NoChange) {
            // not a failure: said calmly in the thread, with the model's own words after it
            set({
              status: "idle",
              history,
              turns: [
                ...state.turns,
                {
                  id: ++turnId,
                  role: "assistant",
                  text: err.said
                    ? `${err.message}\n\n${err.said}`
                    : err.message,
                  task,
                },
              ],
            });
            return;
          }
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

  const session: Session = {
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
      chatId = null;
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
        turns: was ? withOutcome(state.turns, was, "Discarded") : state.turns,
      });
    },
    async keep() {
      const p = state.proposal;
      if (!p) {
        ctx.ui.toast("There is no proposed change to keep");
        return;
      }
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
          await ctx.scene.batch(p.ops, {
            path: p.path ?? undefined,
            ...(p.drawing ? { drawing: p.drawing } : {}),
          });
          const kept = p.done || p.headline;
          set({
            proposal: null,
            error: null,
            kept,
            turns: withOutcome(state.turns, p, kept, {
              applied: true,
              undoPath: p.path ?? undefined,
            }),
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
          const kept = `Created "${made}"`;
          set({
            proposal: null,
            error: null,
            kept,
            turns: withOutcome(state.turns, p, kept, { applied: true }),
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
    async chats() {
      const vault = ctx.vault.info()?.name ?? "";
      const list = ((await ctx.storage.global.get<Json>(INDEX_KEY)) ??
        []) as unknown as ChatSummary[];
      return list.filter((c) => c.vault === vault);
    },
    async openChat(id) {
      const rec = (await ctx.storage.global.get<Json>(chatKey(id))) as
        | StoredChat
        | undefined;
      if (!rec || !Array.isArray(rec.turns)) {
        ctx.ui.toast("This chat could not be opened", { kind: "error" });
        return;
      }
      controller?.abort();
      const turns: Turn[] = rec.turns.map((t) => ({ ...t, id: ++turnId }));
      const task = turns.at(-1)?.task ?? "ask";
      // the follow-up context of an ask chat is its questions and answers
      const history: ChatMessage[] =
        task === "ask"
          ? turns
              .filter((t) => t.task === "ask" && t.text)
              .map((t) => ({ role: t.role, content: t.text }))
          : [];
      chatId = rec.id;
      restoring = true;
      set({
        status: "idle",
        task,
        request: "",
        answer: "",
        error: null,
        history,
        drawn: null,
        proposal: null,
        kept: null,
        turns,
        view: "chat",
      });
      restoring = false;
    },
    async deleteChat(id) {
      const store = ctx.storage.global;
      const list = ((await store.get<Json>(INDEX_KEY)) ??
        []) as unknown as ChatSummary[];
      await store.delete(chatKey(id));
      await store.set(
        INDEX_KEY,
        list.filter((c) => c.id !== id) as unknown as Json,
      );
      if (chatId === id) {
        chatId = null;
      }
    },
    undo(turnId) {
      const t = state.turns.find((x) => x.id === turnId);
      if (!t || !t.applied || t.undone || t.undoPath === undefined) {
        return;
      }
      if (ctx.scene.path() !== t.undoPath) {
        ctx.ui.toast("Open the drawing this change was made in, then undo it");
        return;
      }
      // the app's own undo (one step); the canvas listens for its key on the document
      const mac = /mac/i.test(navigator.platform);
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          metaKey: mac,
          ctrlKey: !mac,
          bubbles: true,
          cancelable: true,
        }),
      );
      set({
        turns: state.turns.map((x) =>
          x.id === turnId ? { ...x, undone: true } : x,
        ),
      });
    },
    async setAccess(mode) {
      await ctx.settings.set("access", mode);
      set({ access: mode });
    },
    async cycleAccess() {
      const next = nextAccess(accessNow());
      await ctx.settings.set("access", next);
      set({ access: next });
      ctx.ui.toast(`Permission: ${ACCESS_LABEL[next]}`);
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
  return session;
}

function withOutcome(
  turns: readonly Turn[],
  proposal: Proposal,
  outcome: string,
  extra: Partial<Turn> = {},
): Turn[] {
  return turns.map((t) =>
    t.proposal === proposal ? { ...t, outcome, ...extra } : t,
  );
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
