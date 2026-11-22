import { describe, expect, it } from "vitest";

import {
  autosaveKeepsUp,
  showUnsavedMark,
  tabStatusFor,
} from "./unsavedMark";

describe("unsaved mark (toimprove 347)", () => {
  it("autosave within 2 s keeps up: no mark while typing or saving", () => {
    expect(autosaveKeepsUp(500)).toBe(true);
    expect(showUnsavedMark("dirty", 500)).toBe(false);
    expect(showUnsavedMark("saving", 2000)).toBe(false);
    expect(tabStatusFor("dirty", 500)).toBe("saved");
  });

  it("autosave off (0) or slow shows the mark until the edits are saved", () => {
    expect(showUnsavedMark("dirty", 0)).toBe(true);
    expect(showUnsavedMark("saving", 0)).toBe(true);
    expect(showUnsavedMark("dirty", 10_000)).toBe(true);
    expect(tabStatusFor("dirty", 0)).toBe("dirty");
    expect(showUnsavedMark("saved", 0)).toBe(false);
  });

  it("conflicts and errors always show, whatever the autosave", () => {
    expect(tabStatusFor("conflict", 500)).toBe("conflict");
    expect(tabStatusFor("error", 500)).toBe("error");
  });
});
