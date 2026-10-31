import { describe, expect, it, vi } from "vitest";

import { insertVaultPicture, tooBigMessage } from "./insertPicture";

const prefs = { imagesCompress: "auto", imagesMaxInsertMb: 4 } as const;

const editor = (readOnly = false) => {
  const insertImages = vi.fn(async () => {});
  return {
    insertImages,
    value: {
      readOnly,
      api: {
        insertImages,
        getAppState: () => ({
          zoom: { value: 1 },
          offsetLeft: 0,
          offsetTop: 0,
          scrollX: 0,
          scrollY: 0,
        }),
      } as never,
    },
  };
};

describe("insert a vault picture into the open drawing", () => {
  it("hands the bytes to the editor as a typed file, at the drop point", async () => {
    const e = editor();
    const notify = vi.fn();
    const ok = await insertVaultPicture(
      {
        read: async () => new Uint8Array([1, 2, 3]),
        editor: e.value,
        prefs,
        notify,
      },
      "Pics/Photo One.JPG",
      { x: 120, y: 80 },
    );
    expect(ok).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    const [files, at] = e.insertImages.mock.calls[0] as unknown as [
      File[],
      { x: number; y: number },
    ];
    expect(files[0].name).toBe("Photo One.JPG");
    expect(files[0].type).toBe("image/jpeg");
    expect(files[0].size).toBe(3);
    expect(at).toEqual({ x: 120, y: 80 });
  });

  it.each([
    ["no drawing open", null, "Open a drawing first"],
    ["a read-only drawing", editor(true).value, "read-only"],
  ])("refuses with a plain notice: %s", async (_, ed, words) => {
    const notify = vi.fn();
    const read = vi.fn(async () => new Uint8Array());
    expect(
      await insertVaultPicture({ read, editor: ed, prefs, notify }, "a.png"),
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(notify.mock.calls[0][0]).toContain(words);
  });

  it("a picture that can't be read says why, without codes", async () => {
    const notify = vi.fn();
    const e = editor();
    const read = async () => {
      throw Object.assign(new Error("gone"), { code: "NOT_FOUND" });
    };
    await insertVaultPicture({ read, editor: e.value, prefs, notify }, "a.png");
    expect(notify.mock.calls[0][0]).toMatch(
      /^Couldn't add "a.png"\. The file is no longer there/,
    );
    expect(e.insertImages).not.toHaveBeenCalled();
  });

  it("with shrinking off, a picture over the limit is refused before the editor sees it", async () => {
    const notify = vi.fn();
    const e = editor();
    const big = new Uint8Array(5 * 1024 * 1024);
    const off = { imagesCompress: "off", imagesMaxInsertMb: 4 } as const;
    expect(
      await insertVaultPicture(
        { read: async () => big, editor: e.value, prefs: off, notify },
        "big.png",
      ),
    ).toBe(false);
    expect(notify.mock.calls[0][0]).toBe(
      '"big.png" is 5.0 MB, more than the 4 MB a drawing takes. Turn on "Shrink big pictures" or raise the limit in Settings, Files.',
    );
    expect(e.insertImages).not.toHaveBeenCalled();
  });

  it("with shrinking on, the editor decides after shrinking", () => {
    expect(tooBigMessage("x.png", 50 * 1024 * 1024, prefs)).toBeNull();
  });
});
