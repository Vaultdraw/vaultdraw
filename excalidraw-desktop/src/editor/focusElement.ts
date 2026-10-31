import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type FocusTarget = { elementId: string; containerId: string | null };

/** Breathing room around the focused element, as a fraction of its size. */
const PADDING_RATIO = 0.25;
const MIN_PADDING = 40;

/**
 * Selects an element (the container for bound text) and brings it into view.
 * Small elements are only centered at the current zoom (setViewport
 * `scale-down` never exceeds 100%); large ones zoom out to fit.
 * Returns false when the element no longer exists.
 */
export function focusElement(
  api: ExcalidrawImperativeAPI,
  target: FocusTarget,
): boolean {
  const elements = api.getSceneElements();
  const byId = (id: string | null) =>
    id ? elements.find((el) => el.id === id && !el.isDeleted) : undefined;
  const own = byId(target.elementId);
  const ownContainerId = (own as { containerId?: string | null } | undefined)
    ?.containerId;
  const resolved =
    byId(target.containerId) ?? byId(ownContainerId ?? null) ?? own;
  // A link made from a group ("Copy link to object" on several shapes) names the group.
  const members = resolved
    ? []
    : elements.filter(
        (el) => !el.isDeleted && el.groupIds.includes(target.elementId),
      );
  if (!resolved && members.length === 0) {
    return false;
  }
  const box = resolved
    ? resolved
    : (() => {
        const x1 = Math.min(...members.map((m) => m.x));
        const y1 = Math.min(...members.map((m) => m.y));
        const x2 = Math.max(...members.map((m) => m.x + m.width));
        const y2 = Math.max(...members.map((m) => m.y + m.height));
        return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      })();

  api.updateScene({
    appState: {
      selectedElementIds: resolved
        ? { [resolved.id]: true }
        : Object.fromEntries(members.map((m) => [m.id, true])),
      selectedGroupIds: resolved ? {} : { [target.elementId]: true },
      editingGroupId: null,
    },
    captureUpdate: "NEVER",
  });

  const pad = Math.max(
    MIN_PADDING,
    Math.max(box.width, box.height) * PADDING_RATIO,
  );
  api.setViewport({
    target: [
      box.x - pad,
      box.y - pad,
      box.x + box.width + pad,
      box.y + box.height + pad,
    ],
    fit: "scale-down",
    animation: true,
  });
  return true;
}
