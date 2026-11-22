import { useEffect, useRef, useState } from "react";

import { Icon, Mark } from "./Icons";
import { providerLabel } from "./providers";

import type { Session, SessionState } from "./session";

/** The open chats as a tab strip: it scrolls sideways when full, and a button lists them all. */
export default function Tabs({
  session,
  s,
}: {
  session: Session;
  s: SessionState;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [list, setList] = useState(false);

  // the wheel scrolls the strip sideways (a trackpad already does)
  useEffect(() => {
    const el = strip.current;
    if (!el) {
      return;
    }
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  // the shown tab stays in view; the list button appears only when something is cut off
  useEffect(() => {
    const el = strip.current;
    if (!el) {
      return;
    }
    el.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
    const measure = () => setOver(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.tab, s.tabs]);

  useEffect(() => {
    if (!list) {
      return;
    }
    const off = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !(e.target as Element).closest?.(".vd-ai-tablist")
      ) {
        setList(false);
      }
    };
    document.addEventListener("keydown", off);
    document.addEventListener("mousedown", off);
    return () => {
      document.removeEventListener("keydown", off);
      document.removeEventListener("mousedown", off);
    };
  }, [list]);

  return (
    <>
      <div
        ref={strip}
        className="vd-ai-tabs"
        role="tablist"
        aria-label="Chats"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            session.cycleTab(e.key === "ArrowRight" ? 1 : -1);
            e.preventDefault();
          }
        }}
      >
        {s.tabs.map((t) => {
          const on = t.id === s.tab;
          return (
            <div
              key={t.id}
              className="vd-ai-tabitem"
              data-active={on}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault(); // no autoscroll cursor
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  session.closeTab(t.id);
                }
              }}
            >
              <button
                type="button"
                role="tab"
                className="vd-ai-tabbtn"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                title={`${t.title} · ${providerLabel(t.provider)}`}
                onClick={() => session.switchTab(t.id)}
              >
                <Mark size={14} />
                <span className="vd-ai-ellipsis">{t.title}</span>
              </button>
              <button
                type="button"
                className="vd-ai-tabx"
                aria-label={`Close chat: ${t.title}`}
                title="Close"
                tabIndex={-1}
                onClick={() => session.closeTab(t.id)}
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          );
        })}
      </div>
      {over ? (
        <span className="vd-ai-tablist-wrap">
          <button
            type="button"
            className="vd-ai-icon"
            aria-label="All chats"
            aria-expanded={list}
            title="All chats"
            onClick={() => setList((v) => !v)}
          >
            <Icon name="chevron" />
          </button>
          {list ? (
            <ul className="vd-ai-tablist" role="menu" aria-label="Open chats">
              {s.tabs.map((t) => (
                <li key={t.id} role="none">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={t.id === s.tab}
                    className="vd-ai-tablist-item vd-ai-ellipsis"
                    onClick={() => {
                      session.switchTab(t.id);
                      setList(false);
                    }}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
