/**
 * Everything about connecting, in one place (the gear in the panel header): the subscriptions
 * found on this computer with their status and a re-check, API keys per provider, the defaults
 * (provider, model, reasoning level, what is sent), and a pointer to the rest.
 */
import { useEffect, useState } from "react";

import { Icon } from "./Icons";
import { PROVIDERS, providerDef, type ProviderId } from "./providers";

import type { ContextMode, Session } from "./session";

const STATE_TEXT: Record<string, string> = {
  ready: "Connected",
  login: "Not signed in",
  missing: "Not found",
  found: "Found, not checked",
};

const HELP: Record<string, Record<string, string>> = {
  claude: {
    missing:
      "Install Claude Code (claude.com/claude-code), sign in once, then check again.",
    login: "Open a terminal, run claude, and sign in. Then check again.",
  },
  codex: {
    missing:
      "Install the Codex command line (github.com/openai/codex), then check again.",
    login: "Open a terminal and run codex login. Then check again.",
  },
};

const CONTEXTS: { id: ContextMode; label: string }[] = [
  { id: "auto", label: "The selection, or the whole drawing" },
  { id: "drawing", label: "The whole drawing" },
  { id: "selection", label: "Only the selection" },
  { id: "none", label: "Nothing from the drawing" },
];

export default function SettingsView({
  session,
  s,
}: {
  session: Session;
  s: ReturnType<Session["get"]>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const cfg = session.config();
  const def = providerDef(s.provider);

  useEffect(() => {
    void session.detect(true);
    void session.refreshKeys();
  }, [session]);

  // "AI: Set API key" puts the cursor in the key box of the provider in use
  useEffect(() => {
    if (s.focus.tick > 0 && s.focus.target === "key") {
      const p = def.needsKey ? def : providerDef("anthropic");
      document
        .querySelector<HTMLInputElement>(
          `input[aria-label="${p.label} API key"]`,
        )
        ?.focus();
    }
  }, [s.focus.tick, s.focus.target]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveKey = (p: ProviderId) => {
    const v = drafts[p] ?? "";
    if (v.trim()) {
      void session
        .setKeyFor(p, v)
        .then(() => setDrafts((d) => ({ ...d, [p]: "" })));
    }
  };

  return (
    <div className="vd-ai-settings" aria-label="AI settings">
      <section>
        <div className="vd-ai-sec-head">
          <h3>Your subscription</h3>
          <button
            type="button"
            className="vd-ai-btn"
            disabled={s.checking}
            onClick={() => void session.detect(true)}
          >
            {s.checking ? "Checking…" : "Check again"}
          </button>
        </div>
        <p className="vd-ai-note">
          Uses the Claude Code or Codex you already signed in to on this
          computer. Nothing is stored by Vaultdraw, and nothing is sent until
          you press send.
        </p>
        {PROVIDERS.filter((p) => p.kind === "cli").map((p) => {
          const tool = s.tools?.find((t) => t.id === p.tool);
          const state = s.checking ? "found" : tool?.state ?? "found";
          const label =
            s.tools === null
              ? "Looking…"
              : s.checking
              ? "Checking…"
              : STATE_TEXT[state];
          return (
            <div className="vd-ai-row2" key={p.id} data-state={state}>
              <div className="vd-ai-row2-main">
                <strong>{p.label}</strong>
                <span
                  className={`vd-ai-status vd-ai-status-${state}`}
                  role="status"
                  aria-label={`${p.label} status`}
                >
                  {label}
                </span>
                {tool?.path ? (
                  <span className="vd-ai-via vd-ai-path">{tool.path}</span>
                ) : null}
                {!s.checking && HELP[p.tool!]?.[state] ? (
                  <span className="vd-ai-via">{HELP[p.tool!][state]}</span>
                ) : null}
              </div>
              {state === "ready" && s.provider !== p.id ? (
                <button
                  type="button"
                  className="vd-ai-btn"
                  onClick={() => void session.setModel(p.id, "")}
                >
                  Use {p.label}
                </button>
              ) : null}
              {s.provider === p.id ? (
                <span className="vd-ai-via">In use</span>
              ) : null}
            </div>
          );
        })}
      </section>

      <section>
        <h3>API keys</h3>
        <p className="vd-ai-note">
          Kept in your system keychain, outside your config and your vault. The
          app cannot show a key again.
        </p>
        {PROVIDERS.filter((p) => p.needsKey).map((p) => (
          <div className="vd-ai-keyrow" key={p.id}>
            <div className="vd-ai-row2-main">
              <strong>{p.label}</strong>
              <span
                className="vd-ai-status"
                role="status"
                aria-label={`${p.label} key status`}
              >
                {s.keys[p.id] ? "Key saved" : "No key"}
              </span>
            </div>
            <div className="vd-ai-row">
              <input
                type="password"
                className="vd-ai-keyinput"
                aria-label={`${p.label} API key`}
                placeholder="Paste your API key"
                autoComplete="off"
                value={drafts[p.id] ?? ""}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && saveKey(p.id)}
              />
              <button
                type="button"
                className="vd-ai-btn vd-ai-primary"
                aria-label={`Save ${p.label} key`}
                disabled={!(drafts[p.id] ?? "").trim()}
                onClick={() => saveKey(p.id)}
              >
                Save
              </button>
              {s.keys[p.id] ? (
                <button
                  type="button"
                  className="vd-ai-btn"
                  aria-label={`Remove ${p.label} key`}
                  onClick={() => void session.removeKeyFor(p.id)}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3>Defaults</h3>
        <label className="vd-ai-field">
          <span>Provider</span>
          <select
            value={session.rawProvider() === "auto" ? "auto" : s.provider}
            aria-label="Default provider"
            onChange={(e) =>
              void session.setModel(e.target.value as ProviderId | "auto", "")
            }
          >
            <option value="auto">Automatic (a subscription if found)</option>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.kind === "cli" ? `${p.label} (your subscription)` : p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="vd-ai-field">
          <span>Model</span>
          <select
            aria-label="Default model"
            value={cfg.model}
            onChange={(e) => void session.setModel(s.provider, e.target.value)}
          >
            {!def.models.some((m) => m.id === cfg.model) ? (
              <option value={cfg.model}>{cfg.model}</option>
            ) : null}
            {def.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {def.efforts.length > 0 ? (
          <label className="vd-ai-field">
            <span>Reasoning effort</span>
            <select
              aria-label="Default reasoning effort"
              value={cfg.effort}
              onChange={(e) => void session.setEffort(e.target.value)}
            >
              <option value="">Default</option>
              {def.efforts.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="vd-ai-field">
          <span>What is sent</span>
          <select
            aria-label="Default context"
            value={s.contextMode}
            onChange={(e) =>
              session.setContextMode(e.target.value as ContextMode, true)
            }
          >
            {CONTEXTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <p className="vd-ai-note">
          The address, the timeout and the size limits are in Settings, Plugins,
          AI assistant. Every choice here is also a setting there.
        </p>
      </section>
      <button
        type="button"
        className="vd-ai-btn vd-ai-back"
        onClick={() => session.setView("chat")}
      >
        <Icon name="back" /> Back to the chat
      </button>
    </div>
  );
}
