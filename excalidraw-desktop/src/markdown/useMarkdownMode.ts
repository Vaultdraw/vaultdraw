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

import type {
  ExcalidrawImperativeAPI,
  TextEditorExtension,
} from "@excalidraw/excalidraw/types";

import { registerCommandHandlers } from "../commands/handlerRegistry";
import { getPreferences, subscribePreferences } from "../vault/preferences";

import { applyEdits } from "../editor/links/applyEdits";

import { typingSettingsFrom } from "./markdownSettings";
import { selectedTexts } from "./selectedTexts";
import { toggleFirstTask, toggleTaskInTextarea } from "./taskToggle";

export const MARKDOWN_TOGGLE_COMMAND = "markdown.toggle";
export const MARKDOWN_TOGGLE_TASK_COMMAND = "markdown.toggleTask";
export const MARKDOWN_TOGGLE_BOLD_COMMAND = "markdown.toggleBold";

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
  }, [setDrawingValue]);

  useEffect(
    () =>
      registerCommandHandlers({
        [MARKDOWN_TOGGLE_COMMAND]: toggle,
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
