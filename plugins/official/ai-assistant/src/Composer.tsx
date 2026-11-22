/**
 * The box at the bottom of the panel, built like the agent panels of Zed and opencode: the text
 * grows with what you type (Enter sends, Shift+Enter is a new line, Esc stops), `/` picks a mode,
 * `@` picks what is sent, and a row of controls below holds the + button (what is sent, add an
 * image), the model, the reasoning level, the mode and the send button. Images are pasted or
 * dropped in and shown as thumbnails. The row shortens its labels when the panel is narrow.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  barLevel,
  checkImages,
  contextChip,
  helperKind,
  imageFilesOf,
  imageNote,
  effortBars,
  shortModelLabel,
  type BarLevel,
  type ImageAttachment,
} from "./composerLogic";
import { Icon, Levels } from "./Icons";
import { imageProblem, readImage } from "./imageFiles";
import AccessControl from "./AccessControl";
import Menu, { List, arrowKeys, type MenuItem } from "./Menu";
import { TASK_TITLES, SYSTEM, type Task } from "./prompts";
import { availableModels, providerDef, type ProviderId } from "./providers";

import type { ContextMode, Session } from "./session";

const CONNECT = "connect";

export const TASKS: Task[] = [
  "ask",
  "describe",
  "edit",
  "create",
  "diagram",
  "summarise",
];

/** The word after `/` for each mode. */
export const SLASH: Record<Task, string> = {
  ask: "ask",
  describe: "describe",
  edit: "edit",
  create: "new",
  diagram: "diagram",
  summarise: "summarise",
};

const PLACEHOLDER: Record<Task, string> = {
  ask: "Ask about this drawing",
  describe: "Describe the selection (add a note if you like)",
  diagram: "Describe the diagram to draw, e.g. login flow with a retry",
  summarise: "Summarise (add a note if you like)",
  edit: "Say what to change, e.g. make the login box red and add a Logout box",
  create: "Describe the new drawing, e.g. a three-tier web app",
};

const CONTEXTS: { id: ContextMode; label: string; hint: string; at: string }[] =
  [
    {
      id: "auto",
      label: "Selection, or the whole drawing",
      hint: "default",
      at: "auto",
    },
    { id: "drawing", label: "The whole drawing", hint: "", at: "drawing" },
    { id: "selection", label: "Only the selection", hint: "", at: "selection" },
    { id: "none", label: "Nothing from the drawing", hint: "", at: "none" },
  ];

type Open = null | "model" | "effort" | "mode" | "add" | "sent";

/** Longest model label (characters) at each toolbar level; the effort and mode are icons. */
const MODEL_CHARS: Record<BarLevel, number> = { 0: 18, 1: 13, 2: 9 };

/** The toolbar's width, followed as the panel is resized (full labels where jsdom has no layout). */
function useBarLevel(ref: React.RefObject<HTMLElement | null>): BarLevel {
  const [level, setLevel] = useState<BarLevel>(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const update = () => setLevel(barLevel(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return level;
}

export default function Composer({
  session,
  s,
}: {
  session: Session;
  s: ReturnType<Session["get"]>;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<Open>(null);
  const [active, setActive] = useState(0);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{
    sent: string;
    summary: string;
  } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const level = useBarLevel(bar);
  const running = s.status === "running";
  const def = providerDef(s.provider);
  const cfg = session.config();

  // grows with the text, up to a limit
  useEffect(() => {
    const el = box.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    }
  }, [draft]);

  useEffect(() => {
    if (s.menu.tick > 0) {
      setOpen("model");
    }
  }, [s.menu.tick]);

  useEffect(() => {
    if (s.focus.tick > 0 && s.focus.target === "request") {
      box.current?.focus();
    }
  }, [s.focus.tick, s.focus.target]);

  // a click outside the composer closes an open list
  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // What would be sent: built only while the "what is sent" view is open (nothing runs otherwise).
  const wantsContext = s.task !== "create" && s.task !== "diagram";
  const showSent = open === "sent";
  useEffect(() => {
    if (!showSent || running) {
      return;
    }
    let live = true;
    void session.preview(s.task, draft).then((p) => {
      if (live) {
        setPreview({ sent: p.sent, summary: p.context?.summary ?? "" });
      }
    });
    return () => {
      live = false;
    };
  }, [
    session,
    s.task,
    s.contextMode,
    s.turns.length,
    showSent,
    draft,
    running,
  ]);

  // `/` at the start picks a mode; `@` at the end picks what is sent
  const kind = helperKind(draft);
  const slash = kind === "slash" ? /^\/([a-z]*)$/i.exec(draft) : null;
  const at = kind === "at" ? /(?:^|\s)@([a-z]*)$/i.exec(draft) : null;
  const helper: MenuItem[] = useMemo(() => {
    if (slash) {
      const q = slash[1].toLowerCase();
      return TASKS.filter((t) => SLASH[t].startsWith(q)).map((t) => ({
        id: t,
        label: TASK_TITLES[t],
        hint: `/${SLASH[t]}`,
        checked: s.task === t,
      }));
    }
    if (at) {
      const q = at[1].toLowerCase();
      return CONTEXTS.filter((c) => c.at.startsWith(q)).map((c) => ({
        id: c.id,
        label: c.label,
        hint: `@${c.at}`,
        checked: s.contextMode === c.id,
      }));
    }
    return [];
  }, [slash?.[1], at?.[1], s.task, s.contextMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const helperOn = helper.length > 0 && !open;
  const slashQuery = slash?.[1];
  const atQuery = at?.[1];
  useEffect(() => setActive(0), [slashQuery, atQuery]);

  const pickHelper = (it: MenuItem) => {
    if (slash) {
      session.setTask(it.id as Task);
      setDraft("");
    } else {
      session.setContextMode(it.id as ContextMode);
      setDraft((d) => d.replace(/(^|\s)@[a-z]*$/i, "$1"));
    }
  };

  // Pasted or dropped pictures: checked, shrunk where large, then shown as thumbnails.
  const addFiles = async (picked: File[]) => {
    if (picked.length === 0) {
      return;
    }
    const { accept, problems } = checkImages(
      images.length,
      picked.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    );
    const read: ImageAttachment[] = [];
    for (const i of accept) {
      try {
        read.push(await readImage(picked[i]));
      } catch {
        problems.push(`${picked[i].name || "The image"} could not be read.`);
      }
    }
    setImages((now) => [...now, ...read].slice(0, 4));
    setProblem(problems.length ? problems.join(" ") : null);
  };

  const attachProblem = imageProblem(s.provider, images);
  const note =
    problem ?? attachProblem ?? (images.length ? imageNote(s.provider) : null);

  const send = () => {
    if (running) {
      return;
    }
    if (attachProblem) {
      setProblem(attachProblem);
      return;
    }
    const asked = draft;
    const sentImages = images;
    void session
      .run(
        s.task,
        draft,
        sentImages.map((i) => ({ mime: i.mime, data: i.data })),
      )
      .then(() => {
        // A question that was refused (no key, Offline mode, an empty drawing) stays in the box
        // for the next try (toimprove 270).
        const now = session.get();
        if (now.error && !now.answer) {
          setDraft((d) => (d === "" ? asked : d));
          setImages((cur) => (cur.length === 0 ? sentImages : cur));
        }
      });
    if (s.task === "ask" || s.task === "edit" || s.task === "create") {
      setDraft("");
    }
    setImages([]);
    setProblem(null);
  };

  const available = availableModels({
    tools: s.tools,
    keys: s.keys,
    provider: s.provider,
    rawProvider: session.rawProvider(),
  });
  const modelItems: MenuItem[] =
    available.length === 0
      ? [{ id: CONNECT, label: "Connect a provider…" }]
      : available.map((m) => ({
          id: `${m.provider}|${m.id}`,
          label: m.label,
          group: m.group,
          checked: m.provider === s.provider && m.id === cfg.model,
        }));
  const modelLabel =
    def.models.find((m) => m.id === cfg.model)?.label ?? cfg.model ?? "Default";
  const shortModel = shortModelLabel(modelLabel, MODEL_CHARS[level]);
  const effortItems: MenuItem[] = ["", ...def.efforts].map((e) => ({
    id: e,
    label: e || "Default",
    checked: cfg.effort === e,
  }));
  const modeItems: MenuItem[] = TASKS.map((t) => ({
    id: t,
    label: TASK_TITLES[t],
    hint: `/${SLASH[t]}`,
    checked: s.task === t,
  }));
  // Behind +: what is sent (only for modes that send the drawing), a look at it, and images.
  const addItems: MenuItem[] = [
    ...(wantsContext
      ? CONTEXTS.map((c) => ({
          id: `ctx:${c.id}`,
          label: c.label,
          hint: c.hint,
          group: "Send from the drawing",
          checked: s.contextMode === c.id,
        }))
      : []),
    {
      id: "attach",
      label: "Attach image…",
      group: "Add",
      disabled: images.length >= 4,
    },
    ...(wantsContext
      ? [{ id: "sent", label: "Show what is sent", group: "Add" }]
      : []),
  ];
  const onAdd = (it: MenuItem) => {
    if (it.id === "attach") {
      files.current?.click();
    } else if (it.id === "sent") {
      setOpen("sent");
    } else {
      session.setContextMode(it.id.slice(4) as ContextMode);
    }
  };
  const chip = contextChip(s.contextMode, wantsContext);
  const lit = effortBars(def.efforts, cfg.effort);

  return (
    <div
      className="vd-ai-composer"
      ref={root}
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        setDragging(false);
        const dropped = imageFilesOf(e.dataTransfer?.files);
        if (dropped.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          void addFiles(dropped);
        }
      }}
    >
      {helperOn ? (
        <div className="vd-ai-pop vd-ai-helper">
          <List
            items={helper}
            active={active}
            onPick={pickHelper}
            label={slash ? "Modes" : "Context"}
          />
        </div>
      ) : null}
      {images.length > 0 ? (
        <ul className="vd-ai-thumbs" aria-label="Attached images">
          {images.map((im, n) => (
            <li key={`${im.name}-${n}`} className="vd-ai-thumb">
              <img
                src={`data:${im.mime};base64,${im.data}`}
                alt={im.name || `Image ${n + 1}`}
              />
              <button
                type="button"
                aria-label={`Remove ${im.name || `image ${n + 1}`}`}
                title="Remove"
                onClick={() =>
                  setImages((now) => now.filter((_, k) => k !== n))
                }
              >
                <Icon name="close" size={10} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {note ? (
        <p className="vd-ai-imgnote" role="status">
          {note}
        </p>
      ) : null}
      <textarea
        ref={box}
        className="vd-ai-input"
        aria-label={PLACEHOLDER[s.task]}
        placeholder={PLACEHOLDER[s.task]}
        value={draft}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setOpen(null)}
        onPaste={(e) => {
          const pasted = imageFilesOf(e.clipboardData?.files);
          if (pasted.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            void addFiles(pasted);
          }
        }}
        onKeyDown={(e) => {
          if (helperOn) {
            if (arrowKeys(e, helper.length, active, setActive)) {
              e.preventDefault();
              return;
            }
            if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
              e.preventDefault();
              pickHelper(helper[active]);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && running) {
            e.stopPropagation();
            session.cancel();
          }
        }}
      />
      {chip ? (
        <div className="vd-ai-ctxrow">
          <span className="vd-ai-chip" title="What is sent from the drawing">
            <button
              type="button"
              className="vd-ai-chip-text"
              aria-label="Show what is sent"
              onClick={() => setOpen("sent")}
            >
              {chip}
            </button>
            <button
              type="button"
              className="vd-ai-chip-x"
              aria-label="Back to the default context"
              title="Back to the default"
              onClick={() => session.setContextMode("auto")}
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        </div>
      ) : null}
      {showSent ? (
        <div className="vd-ai-sent" aria-label="What is sent">
          <div className="vd-ai-sent-title">
            Sent to {s.via || "the model"}
            {preview?.summary ? ` (${preview.summary})` : ""}
            <button
              type="button"
              className="vd-ai-icon"
              aria-label="Close what is sent"
              onClick={() => setOpen(null)}
            >
              <Icon name="close" size={11} />
            </button>
          </div>
          <pre>{`Instructions:\n${SYSTEM[s.task]}\n\nMessage:\n${
            preview?.sent || "(nothing yet)"
          }`}</pre>
        </div>
      ) : null}
      <input
        ref={files}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        aria-label="Choose images"
        onChange={(e) => {
          void addFiles(imageFilesOf(e.target.files));
          e.target.value = "";
        }}
      />
      <div className="vd-ai-bar" ref={bar} data-level={level}>
        <Menu
          label="Add context"
          title="Add context or an image"
          trigger={<Icon name="plus" />}
          className="vd-ai-icon"
          items={addItems}
          open={open === "add"}
          setOpen={(o) => setOpen(o ? "add" : null)}
          onPick={onAdd}
        />
        <Menu
          label="Model"
          className="vd-ai-model"
          title={`Model: ${modelLabel}`}
          trigger={
            <>
              <span className="vd-ai-ellipsis">{shortModel}</span>
              <Icon name="chevron" size={11} />
            </>
          }
          items={modelItems}
          search={available.length > 0}
          custom={
            available.length > 0
              ? (q) => ({
                  id: `${s.provider}|${q}`,
                  label: `Use "${q}" with ${def.label}`,
                })
              : undefined
          }
          open={open === "model"}
          setOpen={(o) => setOpen(o ? "model" : null)}
          onPick={(it) => {
            if (it.id === CONNECT) {
              session.setView("settings");
              return;
            }
            const [provider, ...rest] = it.id.split("|");
            void session.setModel(provider as ProviderId, rest.join("|"));
          }}
        />
        {def.efforts.length > 0 ? (
          <Menu
            label="Reasoning effort"
            className="vd-ai-effort vd-ai-icon"
            title={`Reasoning effort: ${cfg.effort || "default"}`}
            trigger={<Levels lit={lit} size={14} />}
            items={effortItems}
            open={open === "effort"}
            setOpen={(o) => setOpen(o ? "effort" : null)}
            onPick={(it) => void session.setEffort(it.id)}
          />
        ) : null}
        <Menu
          label="Mode"
          className="vd-ai-mode vd-ai-icon"
          title={`Mode: ${TASK_TITLES[s.task]} (/${SLASH[s.task]})`}
          trigger={
            <>
              <Icon name="slash" size={14} />
            </>
          }
          items={modeItems}
          open={open === "mode"}
          setOpen={(o) => setOpen(o ? "mode" : null)}
          onPick={(it) => session.setTask(it.id as Task)}
        />
        <AccessControl session={session} mode={s.access} />
        <span className="vd-ai-spacer" />
        {running ? (
          <button
            type="button"
            className="vd-ai-send"
            aria-label="Stop"
            title="Stop (Esc)"
            onClick={() => session.cancel()}
          >
            <Icon name="stop" />
          </button>
        ) : (
          <button
            type="button"
            className="vd-ai-send"
            aria-label="Send"
            title="Send (Enter)"
            onClick={send}
          >
            <Icon name="up" />
          </button>
        )}
      </div>
    </div>
  );
}
