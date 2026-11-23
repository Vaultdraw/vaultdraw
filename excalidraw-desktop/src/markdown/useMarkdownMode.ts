/**
 * Markdown mode of the open drawing: its own switch (saved in the file's
 * `vaultdraw` block) or, when it has none, `markdown.typing`. Binds the
 * `markdown.toggle` command and gives the editor its text editor extension,
 * which loads only once the mode is on (zero cost for drawings with it off).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { viewportCoordsToSceneCoords } from "@excalidraw/common";

import type {
  ExcalidrawImperativeAPI,
  TextEditorExtension,
} from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { getPreferences, subscribePreferences } from "../vault/preferences";

import { applyEdits } from "../editor/links/applyEdits";

import { typingSettingsFrom } from "./markdownSettings";
import { selectedTexts } from "./selectedTexts";
import { canvasMeasure, taskClickAt } from "./taskClick";
import { toggleFirstTask, toggleTaskInTextarea } from "./taskToggle";

const HAS_TASK_BOX = /[☐☑]/;

export const MARKDOWN_TOGGLE_COMMAND = "markdown.toggle";
export const MARKDOWN_TOGGLE_TASK_COMMAND = "markdown.toggleTask";
export const MARKDOWN_TOGGLE_BOLD_COMMAND = "markdown.toggleBold";
export const MARKDOWN_CONVERT_COMMAND = "markdown.convertExisting";

/**
 * ☐ <-> ☑: on the caret's line while a text is edited, else on the first task
 * line of the one selected text or selected shape's label (one undo step). Works with the mode off too:
 * it only edits task lines that are already there.
 */
const toggleTask = (
  api: ExcalidrawImperativeAPI | null,
  container: HTMLElement | null,
) => {
  const textarea = container?.querySelector<HTMLTextAreaElement>(
    "textarea.excalidraw-wysiwyg",
  );
  if (textarea?.isConnected) {
    const before = textarea.value;
    const caret = textarea.selectionStart;
    if (toggleTaskInTextarea(textarea)) {
      // One Cmd+Z takes it back (toimprove 313); the typing module is loaded while it edits.
      void typingModule?.then((m) => m.rememberEditorEdit(before, caret));
    }
    return;
  }
  if (!api) {
    return;
  }
  const state = api.getAppState();
  const selected = selectedTexts(
    api.getSceneElements(),
    state.selectedElementIds,
  );
  if (selected.length !== 1) {
    return;
  }
  const el = selected[0] as unknown as { id: string; originalText: string };
  const next = toggleFirstTask(el.originalText);
  if (next !== null) {
    applyEdits(api, [{ elementId: el.id, field: "text", value: next }]);
  }
};

/** Bold <-> regular: the edited box, else every selected text. Works with the mode off too. */
const toggleBold = async (api: ExcalidrawImperativeAPI | null) => {
  if (typingModule && (await typingModule).toggleBoldInEditor()) {
    return;
  }
  if (api) {
    const { toggleBoldSelected } = await import("./boldToggle");
    await toggleBoldSelected(api);
  }
};

/**
 * Text already on the canvas converted as if typed (toimprove 345): the
 * selection, else the whole drawing; one undo step. The module loads only when used.
 */
const convertExisting = async (
  api: ExcalidrawImperativeAPI | null,
  win: Window | null,
) => {
  if (!api) {
    return;
  }
  const { convertExistingText } = await import("./convertExisting");
  await convertExistingText(api, typingSettingsFrom(getPreferences(win)));
};

type TypingModule = typeof import("./markdownTyping");
let typingModule: Promise<TypingModule> | null = null;
const loadTyping = () => (typingModule ??= import("./markdownTyping"));

let inlineModule: Promise<typeof import("./inlineStyler")> | null = null;
const loadInline = () => (inlineModule ??= import("./inlineStyler"));

/** Re-rasterise the scene's texts after the styler came or went. */
const repaint = (api: ExcalidrawImperativeAPI | null) =>
  api?.updateScene({
    elements: api.getSceneElementsIncludingDeleted(),
    captureUpdate: CaptureUpdateAction.NEVER,
  });

export function useMarkdownMode({
  getWindow,
  getApi,
  getContainer,
  isWritable,
  onChange,
}: {
  getWindow: () => Window | null;
  getApi: () => ExcalidrawImperativeAPI | null;
  getContainer: () => HTMLElement | null;
  /** False for read-only or disabled drawings: the switch can't change. */
  isWritable: () => boolean;
  /** The drawing's switch changed: save it. */
  onChange: () => void;
}) {
  const live = useRef({
    getWindow,
    getApi,
    getContainer,
    isWritable,
    onChange,
  });
  live.current = { getWindow, getApi, getContainer, isWritable, onChange };

  // null = the drawing has no switch of its own (follows the default)
  const [drawing, setDrawing] = useState<boolean | null>(null);
  const drawingRef = useRef<boolean | null>(null);
  const defaultOn = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(getWindow()).markdownTyping,
  );
  const on = drawing ?? defaultOn;
  const onRef = useRef(on);
  onRef.current = on;

  const extension = useRef<TextEditorExtension | null>(null);
  useEffect(() => {
    if (!on || extension.current) {
      return;
    }
    let cancelled = false;
    void loadTyping().then((m) => {
      if (!cancelled && !extension.current) {
        extension.current = m.createMarkdownTyping({
          isOn: () => onRef.current,
          getSettings: () =>
            typingSettingsFrom(getPreferences(live.current.getWindow())),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [on]);

  // Bold, italic and code words drawn with their marks hidden (step 2): the
  // styler module loads only once a drawing has the mode and live preview on.
  const livePreview = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(getWindow()).markdownLivePreview,
  );
  const drawInline = on && livePreview;
  const drawInlineRef = useRef(drawInline);
  drawInlineRef.current = drawInline;
  useEffect(() => {
    if (!drawInline) {
      return;
    }
    let off: (() => void) | null = null;
    let cancelled = false;
    void loadInline().then((m) => {
      if (cancelled) {
        return;
      }
      off = m.installInlineStyler();
      repaint(live.current.getApi());
    });
    return () => {
      cancelled = true;
      if (off) {
        off();
        repaint(live.current.getApi());
      }
    };
  }, [drawInline]);

  const setDrawingValue = useCallback((value: boolean | null) => {
    drawingRef.current = value;
    setDrawing(value);
  }, []);

  /** A drawing was loaded: its own switch, or null. */
  const load = useCallback(
    (value: boolean | null) => setDrawingValue(value),
    [setDrawingValue],
  );

  const toggle = useCallback(() => {
    if (!live.current.isWritable()) {
      return;
    }
    setDrawingValue(!onRef.current);
    onRef.current = !onRef.current;
    live.current.onChange();
    const win = live.current.getWindow();
    if (onRef.current && getPreferences(win).markdownConvertOnEnable) {
      void convertExisting(live.current.getApi(), win);
    }
  }, [setDrawingValue]);

  useEffect(
    () =>
      registerCommandHandlers({
        [MARKDOWN_TOGGLE_COMMAND]: toggle,
        [MARKDOWN_CONVERT_COMMAND]: () => {
          // only in a drawing with the mode on: off, its text stays as written
          if (live.current.isWritable() && onRef.current) {
            void convertExisting(
              live.current.getApi(),
              live.current.getWindow(),
            );
          }
        },
        [MARKDOWN_TOGGLE_BOLD_COMMAND]: () => {
          if (live.current.isWritable()) {
            void toggleBold(live.current.getApi());
          }
        },
        [MARKDOWN_TOGGLE_TASK_COMMAND]: () => {
          if (live.current.isWritable()) {
            toggleTask(live.current.getApi(), live.current.getContainer());
          }
        },
      }),
    [toggle],
  );

  // Click a ☐ / ☑ box on the canvas to tick it (toimprove 369). Capture
  // phase, so a hit never reaches the editor (no select, drag or edit).
  useEffect(() => {
    const win = live.current.getWindow() ?? window;
    const boxUnder = (e: MouseEvent) => {
      const { getApi, getContainer, isWritable } = live.current;
      const api = getApi();
      const container = getContainer();
      const target = e.target as HTMLElement | null;
      if (
        !api ||
        !container ||
        (e.type !== "pointermove" && e.button !== 0) ||
        e.shiftKey ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        target?.tagName !== "CANVAS" ||
        !container.contains(target) ||
        container.querySelector("textarea.excalidraw-wysiwyg") ||
        !isWritable()
      ) {
        return null;
      }
      const state = api.getAppState();
      if (state.activeTool.type !== "selection") {
        return null;
      }
      const p = viewportCoordsToSceneCoords(e, state);
      const els = api.getSceneElements();
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        if (
          el.type !== "text" ||
          !HAS_TASK_BOX.test(el.text) ||
          p.x < el.x - el.width ||
          p.x > el.x + el.width ||
          p.y < el.y ||
          p.y > el.y + el.height
        ) {
          continue;
        }
        const next = taskClickAt(el, p.x, p.y, canvasMeasure(el));
        if (next !== null) {
          return { id: el.id, next };
        }
      }
      return null;
    };
    const onDown = (e: PointerEvent) => {
      const found = boxUnder(e);
      const api = live.current.getApi();
      if (found && api) {
        e.preventDefault();
        e.stopPropagation();
        applyEdits(api, [
          { elementId: found.id, field: "text", value: found.next },
        ]);
      }
    };
    // A quick second tick must not open the text for editing.
    const onDouble = (e: MouseEvent) => {
      const container = live.current.getContainer();
      const target = e.target as HTMLElement | null;
      if (
        container?.contains(target) &&
        target?.tagName === "CANVAS" &&
        boxUnder(e) !== null
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // A hand pointer over a box (as over Obsidian's checkboxes): a class the
    // stylesheet turns into the pointer, over the editor's own cursor.
    const onMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName !== "CANVAS") {
        return;
      }
      target.toggleAttribute(
        "data-task-box",
        e.buttons === 0 && boxUnder(e) !== null,
      );
    };
    win.document.addEventListener("pointerdown", onDown, true);
    win.document.addEventListener("dblclick", onDouble, true);
    win.document.addEventListener("pointermove", onMove, true);
    return () => {
      win.document.removeEventListener("pointermove", onMove, true);
      win.document.removeEventListener("pointerdown", onDown, true);
      win.document.removeEventListener("dblclick", onDouble, true);
    };
  }, []);

  /** What the editor reads when a text starts being edited. */
  const textEditorExtension = useCallback(
    () => (onRef.current ? extension.current : null),
    [],
  );

  /** For the save: the drawing's own switch (null = none to store). */
  const getForSave = useCallback(() => drawingRef.current, []);

  /** Whether the canvas draws Markdown words styled; exports then do too. */
  const getDrawsInline = useCallback(() => drawInlineRef.current, []);

  return {
    on,
    toggle,
    load,
    getForSave,
    textEditorExtension,
    getDrawsInline,
  };
}
