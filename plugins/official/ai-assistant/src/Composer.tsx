/**
 * The box at the bottom of the panel, built like the agent panels of Zed and opencode: the text
 * grows with what you type (Enter sends, Shift+Enter is a new line, Esc stops), `/` picks a mode,
 * `@` picks what is sent, and a row of controls below holds the model, the reasoning level, the
 * mode and the send button.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "./Icons";
import Menu, { List, arrowKeys, type MenuItem } from "./Menu";
import { TASK_TITLES, SYSTEM, type Task } from "./prompts";
import { PROVIDERS, providerDef, type ProviderId } from "./providers";

import type { ContextMode, Session } from "./session";

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

type Open = null | "model" | "effort" | "mode" | "add" | "ctx";

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
  const [preview, setPreview] = useState<{
    sent: string;
    summary: string;
  } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
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

  // What would be sent, for the context chip and its list; follows the mode, the choice and the drawing.
  const wantsContext = s.task !== "create" && s.task !== "diagram";
  useEffect(() => {
    if (running || !wantsContext) {
      return;
    }
    let live = true;
    void session.preview(s.task, open === "ctx" ? draft : "").then((p) => {
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
    s.status,
    s.turns.length,
    open,
    draft,
    running,
    wantsContext,
  ]);

  // `/` at the start picks a mode; `@` at the end picks what is sent
  const slash = /^\/([a-z]*)$/i.exec(draft);
  const at = /(?:^|\s)@([a-z]*)$/i.exec(draft);
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
  useEffect(() => setActive(0), [slash?.[1], at?.[1]]);

  const pickHelper = (it: MenuItem) => {
    if (slash) {
      session.setTask(it.id as Task);
      setDraft("");
    } else {
      session.setContextMode(it.id as ContextMode);
      setDraft((d) => d.replace(/(^|\s)@[a-z]*$/i, "$1"));
    }
  };

  const send = () => {
    if (running) {
      return;
    }
    const asked = draft;
    void session.run(s.task, draft).then(() => {
      // A question that was refused (no key, Offline mode, an empty drawing) stays in the box
      // for the next try (toimprove 270).
      const now = session.get();
      if (now.error && !now.answer) {
        setDraft((d) => (d === "" ? asked : d));
      }
    });
    if (s.task === "ask" || s.task === "edit" || s.task === "create") {
      setDraft("");
    }
  };

  const modelItems: MenuItem[] = PROVIDERS.flatMap((p) =>
    p.models.map((m) => {
      const tool = s.tools?.find((t) => t.id === p.tool);
      const missing = p.kind === "cli" && s.tools !== null && !tool?.path;
      return {
        id: `${p.id}|${m.id}`,
        label: m.label,
        group:
          p.group === "Your subscription"
            ? `${p.label} (your subscription)`
            : p.label,
        hint: missing
          ? "not installed"
          : p.needsKey && s.keys[p.id] === false
          ? "needs a key"
          : "",
        checked: p.id === s.provider && m.id === cfg.model,
        disabled: missing,
      };
    }),
  );
  const modelLabel =
    def.models.find((m) => m.id === cfg.model)?.label ?? cfg.model ?? "Default";
  const shortModel = modelLabel.replace(" (recommended)", "");
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
  const ctxItems: MenuItem[] = CONTEXTS.map((c) => ({
    id: c.id,
    label: c.label,
    hint: c.hint,
    checked: s.contextMode === c.id,
  }));
  const chip =
    s.contextMode === "none" && (s.task === "ask" || s.task === "describe")
      ? "Nothing from the drawing"
      : preview?.summary ||
        (s.task === "summarise" ? "Note or text" : "Drawing");

  return (
    <div className="vd-ai-composer" ref={root}>
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
      <textarea
        ref={box}
        className="vd-ai-input"
        aria-label={PLACEHOLDER[s.task]}
        placeholder="Ask anything • @ to add context • / for commands"
        value={draft}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setOpen(null)}
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
      {wantsContext ? (
        <div className="vd-ai-ctxrow">
          <Menu
            label="Choose what is sent"
            title="What is sent: click to change"
            className="vd-ai-chip"
            trigger={<span className="vd-ai-chip-text">{chip}</span>}
            items={ctxItems}
            open={open === "ctx"}
            setOpen={(o) => setOpen(o ? "ctx" : null)}
            onPick={(it) => session.setContextMode(it.id as ContextMode)}
          />
          {open === "ctx" ? (
            <div className="vd-ai-sent" aria-label="What is sent">
              <div className="vd-ai-sent-title">
                Sent to {s.via || "the model"}
                {preview?.summary ? ` (${preview.summary})` : ""}
              </div>
              <pre>{`Instructions:\n${SYSTEM[s.task]}\n\nMessage:\n${
                preview?.sent || "(nothing yet)"
              }`}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="vd-ai-bar">
        <Menu
          label="Add context"
          trigger={<Icon name="plus" />}
          className="vd-ai-icon"
          items={ctxItems}
          open={open === "add"}
          setOpen={(o) => setOpen(o ? "add" : null)}
          onPick={(it) => session.setContextMode(it.id as ContextMode)}
        />
        <Menu
          label="Model"
          className="vd-ai-model"
          trigger={
            <>
              <span className="vd-ai-ellipsis">{shortModel || "Default"}</span>
              <Icon name="chevron" size={11} />
            </>
          }
          items={modelItems}
          search
          custom={(q) => ({
            id: `${s.provider}|${q}`,
            label: `Use "${q}" with ${def.label}`,
          })}
          open={open === "model"}
          setOpen={(o) => setOpen(o ? "model" : null)}
          onPick={(it) => {
            const [provider, ...rest] = it.id.split("|");
            void session.setModel(provider as ProviderId, rest.join("|"));
          }}
        />
        {def.efforts.length > 0 ? (
          <Menu
            label="Reasoning effort"
            className="vd-ai-effort"
            trigger={
              <>
                <span>{cfg.effort || "default"}</span>
                <Icon name="chevron" size={11} />
              </>
            }
            items={effortItems}
            open={open === "effort"}
            setOpen={(o) => setOpen(o ? "effort" : null)}
            onPick={(it) => void session.setEffort(it.id)}
          />
        ) : null}
        <Menu
          label="Mode"
          className="vd-ai-mode"
          trigger={
            <>
              <span className="vd-ai-ellipsis">{TASK_TITLES[s.task]}</span>
              <Icon name="chevron" size={11} />
            </>
          }
          items={modeItems}
          open={open === "mode"}
          setOpen={(o) => setOpen(o ? "mode" : null)}
          onPick={(it) => session.setTask(it.id as Task)}
        />
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
