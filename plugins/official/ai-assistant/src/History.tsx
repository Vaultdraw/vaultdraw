import { useEffect, useState } from "react";

import { Icon } from "./Icons";
import { providerLabel } from "./providers";

import type { ChatSummary, Session } from "./session";

const when = (at: number) => {
  const d = new Date(at);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** The earlier chats of this vault, newest first. Nothing is read from storage until this opens. */
export default function History({ session }: { session: Session }) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);

  useEffect(() => {
    let live = true;
    void session.chats().then((list) => {
      if (live) {
        setChats(list);
      }
    });
    return () => {
      live = false;
    };
  }, [session]);

  if (chats === null) {
    return <div className="vd-ai-history" aria-busy />;
  }
  if (chats.length === 0) {
    return (
      <div className="vd-ai-history">
        <p className="vd-ai-wait">No earlier chats in this vault yet.</p>
      </div>
    );
  }
  return (
    <div className="vd-ai-history">
      <ul className="vd-ai-chats" aria-label="Earlier chats">
        {chats.map((c) => (
          <li key={c.id} className="vd-ai-chat">
            <button
              type="button"
              className="vd-ai-chat-open"
              onClick={() => void session.openChat(c.id)}
            >
              <span className="vd-ai-chat-title vd-ai-ellipsis">{c.title}</span>
              <span className="vd-ai-via">
                {when(c.at)} · {providerLabel(c.provider)}
              </span>
            </button>
            <button
              type="button"
              className="vd-ai-icon vd-ai-chat-delete"
              aria-label={`Delete chat: ${c.title}`}
              title="Delete chat"
              onClick={() => {
                void session
                  .deleteChat(c.id)
                  .then(() =>
                    setChats((l) => (l ? l.filter((x) => x.id !== c.id) : l)),
                  );
              }}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
