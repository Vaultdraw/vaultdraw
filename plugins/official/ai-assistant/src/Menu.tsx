/**
 * The panel's pop-up lists: a trigger button that opens a list above the composer (the model
 * picker, the reasoning level, the mode), and the bare list the `/` and `@` helpers use. Keyboard:
 * Up and Down move, Enter or Tab picks, Esc closes. A list can have a search box and groups.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Icon } from "./Icons";

export interface MenuItem {
  id: string;
  label: string;
  /** Faint text after the label (a slash command, a status). */
  hint?: string;
  group?: string;
  checked?: boolean;
  disabled?: boolean;
}

/** The list itself: groups, a mark on the chosen one, the active row for the keyboard. */
export function List({
  items,
  active,
  onPick,
  label,
}: {
  items: readonly MenuItem[];
  active: number;
  onPick: (item: MenuItem) => void;
  label: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, items]);
  let lastGroup: string | undefined;
  return (
    <ul className="vd-ai-list" role="listbox" aria-label={label} ref={ref}>
      {items.length === 0 ? (
        <li className="vd-ai-list-empty">Nothing matches</li>
      ) : null}
      {items.map((it, i) => {
        const header = it.group && it.group !== lastGroup ? it.group : null;
        lastGroup = it.group;
        return (
          <li key={it.id} role="presentation">
            {header ? <div className="vd-ai-list-group">{header}</div> : null}
            <div
              role="option"
              aria-selected={it.checked ?? false}
              aria-disabled={it.disabled || undefined}
              data-active={i === active}
              className="vd-ai-opt"
              // keeps the focus in the question box while a row is clicked
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => !it.disabled && onPick(it)}
            >
              <span className="vd-ai-opt-check">
                {it.checked ? <Icon name="check" size={12} /> : null}
              </span>
              <span className="vd-ai-opt-label">{it.label}</span>
              {it.hint ? (
                <span className="vd-ai-opt-hint">{it.hint}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Moves `active` with the arrow keys over `n` rows; returns true when it handled the key. */
export function arrowKeys(
  e: { key: string },
  n: number,
  active: number,
  setActive: (i: number) => void,
): boolean {
  if (n === 0) {
    return false;
  }
  if (e.key === "ArrowDown") {
    setActive((active + 1) % n);
    return true;
  }
  if (e.key === "ArrowUp") {
    setActive((active - 1 + n) % n);
    return true;
  }
  return false;
}

export default function Menu({
  label,
  trigger,
  items,
  onPick,
  open,
  setOpen,
  search,
  custom,
  className,
  title,
  disabled,
}: {
  /** The accessible name of the trigger and the list. */
  label: string;
  trigger: ReactNode;
  items: readonly MenuItem[];
  onPick: (item: MenuItem) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Adds a search box that filters the labels. */
  search?: boolean;
  /** With a search box: offer the typed text as its own entry ("Use …"). */
  custom?: (query: string) => MenuItem | null;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? items.filter((i) =>
          `${i.label} ${i.group ?? ""}`.toLowerCase().includes(q),
        )
      : items;
    const extra = q && custom ? custom(query.trim()) : null;
    return extra && !items.some((i) => i.id === extra.id)
      ? [...base, extra]
      : base;
  }, [items, query, custom]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(
        Math.max(
          0,
          items.findIndex((i) => i.checked),
        ),
      );
      setTimeout(() => (search ? box.current : pop.current)?.focus(), 0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setActive(0), [query]);

  const pick = (item: MenuItem) => {
    setOpen(false);
    onPick(item);
  };

  return (
    <>
      <button
        type="button"
        className={`vd-ai-tool ${className ?? ""}`}
        aria-label={label}
        title={title ?? label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open ? (
        <div
          className="vd-ai-pop"
          ref={pop}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            } else if (arrowKeys(e, shown.length, active, setActive)) {
              e.preventDefault();
            } else if (e.key === "Enter" && shown[active]) {
              e.preventDefault();
              pick(shown[active]);
            }
          }}
        >
          {search ? (
            <input
              ref={box}
              className="vd-ai-search"
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : null}
          <List items={shown} active={active} onPick={pick} label={label} />
        </div>
      ) : null}
    </>
  );
}
