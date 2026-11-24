/** Mounts the panels plugins declared; a panel's code loads when it first opens. */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useNavigatorOverlay } from "../../layout/useNavigatorOverlay";
import { PanelHost } from "../../slots/PanelHost";
import { getPreferences, updatePreferences } from "../../vault/preferences";
import { closePanel, usePanelOpen } from "../../slots/panelStore";

import {
  clampPanelWidth,
  dragPanelWidth,
  panelFits,
  keyPanelWidth,
  PANEL_DEFAULT_WIDTH,
  savedPanelWidth,
  withPanelWidth,
} from "./panelWidth";
import { PluginBoundary } from "./PluginBoundary";
import {
  getPluginPanels,
  subscribePluginPanels,
  type PluginPanelStub,
} from "./panelRegistry";

import "./pluginPanels.css";

import type { ComponentType } from "react";

// Shares this chunk: the status bar loads with the panel host, and draws nothing until an item has text.
export { PluginStatusBar } from "./PluginStatusBar";

const wrapped = new WeakMap<ComponentType, ComponentType>();

const withBoundary = (pluginId: string, C: ComponentType): ComponentType => {
  let W = wrapped.get(C);
  if (!W) {
    W = () => (
      <PluginBoundary pluginId={pluginId}>
        <C />
      </PluginBoundary>
    );
    wrapped.set(C, W);
  }
  return W;
};

const loaders = new WeakMap<PluginPanelStub, PluginPanelStub["load"]>();
const boundaryLoad = (stub: PluginPanelStub) => {
  let load = loaders.get(stub);
  if (!load) {
    load = async () => {
      const { default: C } = await stub.load();
      return { default: withBoundary(stub.pluginId, C) };
    };
    loaders.set(stub, load);
  }
  return load;
};

/** Drag handle on a panel's left edge: drag, arrow keys or double-click (reset); width is saved per panel. */
function usePanelWidth(
  id: string,
  asideRef: React.RefObject<HTMLElement | null>,
  open: boolean,
) {
  const winW = () => window.innerWidth;
  const [width, setWidth] = useState(() =>
    savedPanelWidth(getPreferences().panelWidths, id, winW()),
  );
  // The window can shrink after the width was chosen or remembered: show the width that still
  // leaves the drawing its room, and grow back to the chosen one when the window does.
  const [winWidth, setWinWidth] = useState(winW);
  // The row's width beside the other docked parts (activity bar, file list), measured: they change
  // width too (the file list opens, is dragged wider), and the drawing must keep its room anyway.
  const [room, setRoom] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const row = asideRef.current?.parentElement;
    if (!row) {
      return undefined;
    }
    const measure = () => {
      setWinWidth(winW());
      let others = 0;
      for (const el of Array.from(row.children)) {
        if (
          el !== asideRef.current &&
          !el.classList.contains("vault-editor-pane") &&
          getComputedStyle(el).position !== "absolute"
        ) {
          others += (el as HTMLElement).offsetWidth;
        }
      }
      setRoom(row.clientWidth - others);
    };
    measure();
    const ro =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(row);
    for (const el of Array.from(row.children)) {
      if (el !== asideRef.current) {
        ro?.observe(el);
      }
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [asideRef, open]);
  const shown = clampPanelWidth(width, winWidth, room);
  // The editor measures its canvas when the window resizes; the panel giving way after that
  // (the clamp above) changes the drawing's room without one, so ask it to measure again.
  const settled = useRef(shown);
  useLayoutEffect(() => {
    if (settled.current !== shown) {
      settled.current = shown;
      const id = requestAnimationFrame(() =>
        window.dispatchEvent(new Event("resize")),
      );
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [shown]);
  const live = useRef(shown);
  live.current = shown;
  const commit = (next: number) => {
    setWidth(next);
    live.current = next;
    updatePreferences({
      panelWidths: withPanelWidth(getPreferences().panelWidths, id, next),
    });
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const aside = asideRef.current;
    if (!aside || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = aside.getBoundingClientRect().width;
    let next = startWidth;
    aside.classList.add("vault-plugin-panel--resizing");
    const onMove = (e: PointerEvent) => {
      next = dragPanelWidth(startWidth, startX, e.clientX, winW());
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      aside.classList.remove("vault-plugin-panel--resizing");
      commit(next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const next = keyPanelWidth(event.key, live.current, winW());
    if (next !== null) {
      event.preventDefault();
      commit(next);
    }
  };
  return {
    width: shown,
    room,
    handleProps: {
      onPointerDown,
      onKeyDown,
      onDoubleClick: () => commit(PANEL_DEFAULT_WIDTH),
    },
  };
}

function PluginPanel({
  stub,
  narrow,
}: {
  stub: PluginPanelStub;
  narrow: boolean;
}) {
  const open = usePanelOpen(stub.id);
  const onClose = useCallback(() => closePanel(stub.id), [stub.id]);
  const asideRef = useRef<HTMLElement>(null);
  const { width, room, handleProps } = usePanelWidth(stub.id, asideRef, open);
  // Docked only while the drawing keeps 320 px beside the panel; else it floats over the drawing,
  // as in a narrow window (the file list's rule).
  const floating = narrow || (room !== undefined && !panelFits(room));
  // A floating panel: Esc and a click on the strip of drawing beside it close it (toimprove 285;
  // Obsidian's right drawer).
  useNavigatorOverlay(
    floating && open ? document : null,
    floating && open,
    onClose,
    null,
  );
  if (!open) {
    return null;
  }
  return (
    <>
      {floating && (
        <div
          className="vault-navigator-scrim"
          data-testid={`plugin-panel-scrim-${stub.id}`}
          onPointerDown={onClose}
        />
      )}
      <aside
        className={`vault-plugin-panel${
          floating ? " vault-plugin-panel--overlay" : ""
        }`}
        data-testid={`plugin-panel-${stub.id}`}
        aria-label={stub.title}
        ref={asideRef}
        style={floating ? undefined : { width, flexBasis: width }}
      >
        {!floating && (
          <div
            className="vault-plugin-panel__resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${stub.title}`}
            aria-valuenow={width}
            tabIndex={0}
            {...handleProps}
          />
        )}
        <PanelHost
          id={stub.id}
          load={boundaryLoad(stub)}
          open
          onClose={onClose}
          props={{}}
        />
      </aside>
    </>
  );
}

export function PluginPanels({ narrow = false }: { narrow?: boolean }) {
  const panels = useSyncExternalStore(
    subscribePluginPanels,
    getPluginPanels,
    getPluginPanels,
  );
  return (
    <>
      {panels.map((stub) => (
        <PluginPanel key={stub.id} stub={stub} narrow={narrow} />
      ))}
    </>
  );
}
