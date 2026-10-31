/**
 * The answers to the `when` clauses of a menu's plugin items, for the row the menu opened on.
 * Facts that look at a file answer a moment after the menu opens; their items appear then.
 */
import { useEffect, useState } from "react";

import { factClauses, resolveFacts } from "./menuRegistry";

import type { MenuItemStub } from "./menuRegistry";
import type { MenuTarget } from "./api";

const NONE: Readonly<Record<string, boolean>> = {};

export function useMenuFacts(
  items: readonly MenuItemStub[],
  target: MenuTarget,
): Readonly<Record<string, boolean>> {
  const [resolved, setResolved] = useState(NONE);
  const key = `${target.surface}|${target.path ?? ""}|${target.kind ?? ""}`;
  useEffect(() => {
    const clauses = factClauses(items);
    if (clauses.length === 0) {
      return;
    }
    let live = true;
    void resolveFacts(clauses, target).then((r) => {
      if (live) {
        setResolved(r);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, key]);
  return resolved;
}
