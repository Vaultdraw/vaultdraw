/**
 * The picture viewer tab: the picture fitted to the pane, zoom (buttons, Mod+= / Mod+- / Mod+0,
 * Ctrl or pinch on the wheel), pan (drag, wheel), double-click for 100% and back. Reads the
 * file's bytes once into a blob URL (revoked when the tab closes) and again when the file
 * changes on disk. Nothing is written.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { defineContextKey } from "../commands/contextKeys";
import { userError } from "../components/userError";

import { PICTURE_ACTIVE_KEY, PICTURE_COMMAND_IDS as ID } from "./assetCommands";
import { baseName, formatBytes, pictureMime } from "./assetMime";
import {
  actualSizeAt,
  fitView,
  panBy,
  percent,
  zoomAt,
  zoomCentre,
  ZOOM_STEP,
  type Size,
  type View,
} from "./pictureZoom";

import "./attachments.css";

import type { TabKindViewProps } from "../tabs/tabKinds";

type Loaded = { url: string; bytes: number } | { error: string } | null;

const PictureView = ({ path, vault }: TabKindViewProps) => {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0, fit: true });
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const naturalRef = useRef(natural);
  naturalRef.current = natural;

  const stageSize = (): Size => {
    const el = stageRef.current;
    return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 0, h: 0 };
  };

  const load = useCallback(async () => {
    const read = vault.readAsset;
    if (!read) {
      setLoaded({ error: "Pictures can only be shown in the desktop app." });
      return;
    }
    try {
      const bytes = await read(path);
      const url = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: pictureMime(path) }),
      );
      setLoaded((prev) => {
        if (prev && "url" in prev) {
          URL.revokeObjectURL(prev.url);
        }
        return { url, bytes: bytes.length };
      });
    } catch (err) {
      setLoaded({ error: userError(err, "Couldn't read the picture.") });
    }
  }, [path, vault]);

  useEffect(() => {
    void load();
  }, [load]);

  // The blob URL lives as long as the tab.
  const urlRef = useRef<string | null>(null);
  urlRef.current = loaded && "url" in loaded ? loaded.url : null;
  useEffect(
    () => () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    },
    [],
  );

  // Changed on disk (an editor, a sync): read it again.
  useEffect(
    () =>
      vault.watch?.((paths, rescan) => {
        if (rescan || paths.includes(path)) {
          void load();
        }
      }),
    [vault, path, load],
  );

  // Fit follows the pane size until the user zooms or pans.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || !natural) {
      return;
    }
    const refit = () => {
      if (viewRef.current.fit) {
        setView(fitView(stageSize(), natural));
      }
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [natural]);

  const fit = useCallback(() => {
    const n = naturalRef.current;
    if (n) {
      setView(fitView(stageSize(), n));
    }
  }, []);
  const zoom = useCallback((factor: number) => {
    setView((v) => zoomCentre(v, factor, stageSize()));
  }, []);
  const actual = useCallback(() => {
    const s = stageSize();
    setView((v) => actualSizeAt(v, s.w / 2, s.h / 2));
  }, []);

  useEffect(() => {
    const off = defineContextKey(PICTURE_ACTIVE_KEY, () => true);
    const unbind = registerCommandHandlers({
      [ID.zoomIn]: () => zoom(ZOOM_STEP),
      [ID.zoomOut]: () => zoom(1 / ZOOM_STEP),
      [ID.fit]: fit,
      [ID.actualSize]: actual,
      [ID.reload]: () => void load(),
    });
    return () => {
      unbind();
      off();
    };
  }, [zoom, fit, actual, load]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const box = el.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      // Pinch on a trackpad arrives as Ctrl+wheel.
      const factor = Math.exp(-e.deltaY * 0.01);
      setView((v) =>
        zoomAt(v, factor, e.clientX - box.left, e.clientY - box.top),
      );
    } else {
      setView((v) => panBy(v, -e.deltaX, -e.deltaY));
    }
  }, []);

  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) {
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    if (dx || dy) {
      setView((v) => panBy(v, dx, dy));
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const box = el.getBoundingClientRect();
    if (view.fit && Math.abs(view.scale - 1) > 1e-6) {
      setView((v) =>
        actualSizeAt(v, e.clientX - box.left, e.clientY - box.top),
      );
    } else {
      fit();
    }
  };

  const name = baseName(path);
  return (
    <div className="picture-view" data-picture-path={path}>
      <div className="picture-view__bar" role="toolbar" aria-label="Picture">
        <span className="picture-view__name" title={path}>
          {name}
        </span>
        {natural && loaded && "url" in loaded && (
          <span className="picture-view__facts">
            {natural.w} × {natural.h} · {formatBytes(loaded.bytes)}
          </span>
        )}
        <span className="picture-view__spacer" />
        <button
          type="button"
          className="picture-view__btn"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => zoom(1 / ZOOM_STEP)}
          disabled={!natural}
        >
          −
        </button>
        <span className="picture-view__zoom" aria-live="polite">
          {percent(view.scale)}
        </span>
        <button
          type="button"
          className="picture-view__btn"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => zoom(ZOOM_STEP)}
          disabled={!natural}
        >
          +
        </button>
        <button
          type="button"
          className="picture-view__btn picture-view__btn--text"
          onClick={fit}
          aria-pressed={view.fit}
          disabled={!natural}
        >
          Fit
        </button>
        <button
          type="button"
          className="picture-view__btn picture-view__btn--text"
          onClick={actual}
          disabled={!natural}
        >
          100%
        </button>
      </div>
      <div
        ref={stageRef}
        className="picture-view__stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {loaded === null && (
          <div className="picture-view__note" aria-busy="true" />
        )}
        {loaded && "error" in loaded && (
          <div className="picture-view__note" role="alert">
            <p>Couldn't show this picture. {loaded.error}</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}
        {loaded && "url" in loaded && (
          <img
            className="picture-view__img"
            src={loaded.url}
            alt={name}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              const n = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
              setNatural(n);
              if (viewRef.current.fit) {
                setView(fitView(stageSize(), n));
              }
            }}
            onError={() =>
              setLoaded({
                error: "The file is not a picture this app can show.",
              })
            }
            style={{
              width: natural ? `${natural.w}px` : undefined,
              height: natural ? `${natural.h}px` : undefined,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              visibility: natural ? "visible" : "hidden",
            }}
          />
        )}
      </div>
    </div>
  );
};

export default PictureView;
