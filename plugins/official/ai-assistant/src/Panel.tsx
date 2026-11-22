import { useEffect, useRef, useSyncExternalStore } from "react";

import Composer, { SLASH, TASKS } from "./Composer";
import Ghosts from "./Ghosts";
import { Icon, Mark } from "./Icons";
import Markdown from "./markdown";
import { TASK_TITLES, type Task } from "./prompts";
import { providerDef } from "./providers";
import SettingsView from "./SettingsView";

import type { Session, Turn } from "./session";

const HINT: Record<Task, string> = {
  ask: "Ask about this drawing",
  describe: "Describe the selection",
  edit: "Change the drawing",
  create: "Make a new drawing",
  diagram: "Draw a diagram from text",
  summarise: "Summarise this note or drawing",
};

export default function Panel({ session }: { session: Session }) {
  const s = useSyncExternalStore(session.subscribe, session.get);

  useEffect(() => {
    void session.refreshKey();
    void session.detect(false);
    void session.refreshKeys();
  }, [session]);

  const def = providerDef(s.provider);
  return (
    <div className="vd-ai">
      <div className="vd-ai-head">
        <div className="vd-ai-tab" aria-label="Current chat" title={s.via}>
          <Mark />
          <span className="vd-ai-ellipsis">{def.label}</span>
        </div>
        <button
          type="button"
          className="vd-ai-icon"
          aria-label="New chat"
          title="New chat"
          onClick={() => session.clear()}
        >
          <Icon name="plus" />
        </button>
        <span className="vd-ai-spacer" />
        <button
          type="button"
          className="vd-ai-icon"
          aria-label="AI settings"
          aria-pressed={s.view === "settings"}
          title="Settings"
          onClick={() =>
            session.setView(s.view === "settings" ? "chat" : "settings")
          }
        >
          <Icon name="gear" />
        </button>
      </div>
      {s.view === "settings" ? (
        <SettingsView session={session} s={s} />
      ) : (
        <>
          <Thread session={session} s={s} />
          <Composer session={session} s={s} />
        </>
      )}
    </div>
  );
}

function Thread({
  session,
  s,
}: {
  session: Session;
  s: ReturnType<Session["get"]>;
}) {
  const end = useRef<HTMLDivElement>(null);
  const running = s.status === "running";
  const planTask = s.task === "edit" || s.task === "create";
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [s.turns.length, s.answer, s.error, s.proposal, s.kept]);

  const lastAssistant = [...s.turns]
    .reverse()
    .find((t) => t.role === "assistant");
  return (
    <div className="vd-ai-thread" role="log" aria-label="Conversation">
      {s.turns.length === 0 && !running ? (
        <div className="vd-ai-empty">
          <Mark size={28} />
          <h2>What can I do for you?</h2>
          <ul className="vd-ai-hints" aria-label="Modes">
            {TASKS.map((t) => (
              <li key={t}>
                <button type="button" onClick={() => session.setTask(t)}>
                  <code>/{SLASH[t]}</code> {HINT[t]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {s.turns.map((t) => (
        <TurnView
          key={t.id}
          turn={t}
          session={session}
          s={s}
          last={t === lastAssistant && !running}
        />
      ))}
      {running ? (
        <div
          className="vd-ai-turn vd-ai-assistant"
          aria-live="polite"
          aria-busy
        >
          {planTask ? (
            <p className="vd-ai-wait">Working out the changes…</p>
          ) : s.answer ? (
            <Markdown text={s.answer} />
          ) : (
            <p className="vd-ai-wait">Waiting for the answer…</p>
          )}
        </div>
      ) : null}
      {s.error ? (
        <p className="vd-ai-error" role="alert">
          {s.error}
        </p>
      ) : null}
      {s.kept ? (
        <p className="vd-ai-kept" role="status">
          {s.kept}
        </p>
      ) : null}
      <div ref={end} />
    </div>
  );
}

function TurnView({
  turn,
  session,
  s,
  last,
}: {
  turn: Turn;
  session: Session;
  s: ReturnType<Session["get"]>;
  last: boolean;
}) {
  if (turn.role === "user") {
    return (
      <div className="vd-ai-turn vd-ai-user">
        <span className="vd-ai-badge">{TASK_TITLES[turn.task]}</span>
        <p>{turn.text}</p>
      </div>
    );
  }
  const p = turn.proposal;
  if (p && turn.outcome) {
    // once kept or discarded, the card shrinks to one line in the history
    return (
      <p className="vd-ai-outcome">
        {p.headline}: {turn.outcome}
      </p>
    );
  }
  return (
    <div className="vd-ai-turn vd-ai-assistant">
      {turn.text ? <Markdown text={turn.text} /> : null}
      {p ? (
        <div className="vd-ai-proposal" aria-label="Proposed change">
          <strong>{p.headline}</strong>
          <span className="vd-ai-via">
            {turn.outcome
              ? turn.outcome
              : p.kind === "edit"
              ? "Nothing is changed until you keep it."
              : "Nothing is saved until you keep it."}
          </span>
          <Ghosts ghosts={p.ghosts} />
          <ul className="vd-ai-changes" aria-label="Changes">
            {p.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {p.skipped > 0 ? (
            <span className="vd-ai-via">
              {p.skipped} part{p.skipped === 1 ? "" : "s"} of the reply made no
              sense and {p.skipped === 1 ? "was" : "were"} left out.
            </span>
          ) : null}
          {!turn.outcome && s.proposal === p ? (
            <div className="vd-ai-row">
              <button
                type="button"
                className="vd-ai-btn vd-ai-primary"
                onClick={() => void session.keep()}
              >
                Keep
              </button>
              <button
                type="button"
                className="vd-ai-btn"
                onClick={() => session.discard()}
              >
                Discard
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {turn.text ? (
        <div className="vd-ai-row vd-ai-actions">
          <button
            type="button"
            className="vd-ai-btn vd-ai-ghost"
            aria-label="Copy"
            onClick={() => void session.copyAnswer(turn.text)}
          >
            <Icon name="copy" size={12} /> Copy
          </button>
          {last && turn.task === "diagram" ? (
            <button
              type="button"
              className="vd-ai-btn vd-ai-primary"
              onClick={() => void session.draw()}
            >
              Draw it
            </button>
          ) : null}
          {last && s.drawn !== null ? (
            <span className="vd-ai-via">
              Drew {s.drawn} shapes. Undo with{" "}
              {/mac/i.test(navigator.platform) ? "Cmd" : "Ctrl"}+Z.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
