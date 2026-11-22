/** The composer bar's permission control: one small icon, a list of the three modes above it. */
import { useEffect, useRef, useState } from "react";

import {
  ACCESS_HINT,
  ACCESS_LABEL,
  ACCESS_MODES,
  type AccessMode,
} from "./access";
import Menu, { type MenuItem } from "./Menu";

import type { Session } from "./session";

/** Plain strokes in the current colour, like the panel's other icons. */
const PATHS: Record<AccessMode, string> = {
  // a shield: asks before it acts
  ask: "M8 2 3 4v4c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4Z",
  // a bolt: acts at once
  auto: "M9 2 4 9h4l-1 5 5-7H8Z",
  // an eye: only looks
  read: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z",
};

function AccessIcon({ mode }: { mode: AccessMode }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[mode]} />
    </svg>
  );
}

export default function AccessControl({
  session,
  mode,
}: {
  session: Session;
  mode: AccessMode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  // a click outside closes the list
  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const items: MenuItem[] = ACCESS_MODES.map((m) => ({
    id: m,
    label: ACCESS_LABEL[m],
    hint: ACCESS_HINT[m],
    checked: m === mode,
  }));
  return (
    <span ref={wrap} className="vd-ai-access">
      <Menu
        label="Permission"
        title={`${ACCESS_LABEL[mode]}: ${ACCESS_HINT[mode]}`}
        className="vd-ai-icon"
        trigger={<AccessIcon mode={mode} />}
        items={items}
        open={open}
        setOpen={setOpen}
        onPick={(it) => void session.setAccess(it.id as AccessMode)}
      />
    </span>
  );
}
