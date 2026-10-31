import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopVaultRepository } from "../vault/DesktopVaultRepository";

const tauriInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));

describe("export_file IPC contract", () => {
  it("sends the bytes as the raw body and the name in a header", async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const repo = new DesktopVaultRepository({ invoke });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await expect(
      repo.exportFile("My drawing ✓.excalidraw.png", bytes),
    ).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, body, options] = invoke.mock.calls[0];
    expect(command).toBe("export_file");
    // Not a JSON number array: that was ~4x the payload.
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body).toBe(bytes);
    expect(options.headers["x-file-name"]).toBe(
      encodeURIComponent("My drawing ✓.excalidraw.png"),
    );
    expect(decodeURIComponent(options.headers["x-file-name"])).toBe(
      "My drawing ✓.excalidraw.png",
    );
  });

  it("reports a cancelled save dialog as false, not an error", async () => {
    const repo = new DesktopVaultRepository({
      invoke: vi.fn().mockResolvedValue(false),
    });
    await expect(repo.exportFile("a.png", new Uint8Array([1]))).resolves.toBe(
      false,
    );
  });

  it("normalizes native errors", async () => {
    const repo = new DesktopVaultRepository({
      invoke: vi
        .fn()
        .mockRejectedValue({ code: "EXPORT_FAILED", message: "disk full" }),
    });
    await expect(
      repo.exportFile("a.png", new Uint8Array([1])),
    ).rejects.toMatchObject({ message: expect.stringContaining("disk full") });
  });
});

describe("copy_to_clipboard IPC contract", () => {
  beforeEach(() => {
    tauriInvoke.mockReset();
    vi.resetModules();
  });
  const tauriWindow = () =>
    ({
      __TAURI_INTERNALS__: { invoke: () => {} },
      navigator: { clipboard: { writeText: vi.fn(), write: vi.fn() } },
    } as unknown as Window);

  it("sends raw bytes with an x-clipboard-kind header", async () => {
    tauriInvoke.mockResolvedValue(null);
    const { copyToClipboard } = await import("../vault/clipboard");
    const bytes = new Uint8Array([1, 2, 3]);
    await copyToClipboard("png", bytes, tauriWindow());
    expect(tauriInvoke).toHaveBeenCalledWith("copy_to_clipboard", bytes, {
      headers: { "x-clipboard-kind": "png" },
    });
  });

  it("falls back to the web clipboard only for UNSUPPORTED", async () => {
    tauriInvoke.mockRejectedValue({ code: "UNSUPPORTED", message: "no" });
    const { copyToClipboard } = await import("../vault/clipboard");
    const win = tauriWindow();
    await copyToClipboard("svg", new TextEncoder().encode("<svg/>"), win);
    expect(win.navigator.clipboard.writeText).toHaveBeenCalledWith("<svg/>");
  });

  it("surfaces other native errors instead of silently falling back", async () => {
    tauriInvoke.mockRejectedValue({ code: "CLIPBOARD_FAILED", message: "x" });
    const { copyToClipboard } = await import("../vault/clipboard");
    const win = tauriWindow();
    await expect(
      copyToClipboard("svg", new TextEncoder().encode("<svg/>"), win),
    ).rejects.toMatchObject({ code: "CLIPBOARD_FAILED" });
    expect(win.navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});

describe("save_drawing_copy IPC contract", () => {
  it("passes only the vault handle and path (native copies the bytes)", async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const repo = new DesktopVaultRepository({ invoke });
    await expect(repo.saveDrawingCopy("h1", "A/B.excalidraw")).resolves.toBe(
      true,
    );
    expect(invoke).toHaveBeenCalledWith("save_drawing_copy", {
      handle: "h1",
      path: "A/B.excalidraw",
    });
  });
});

describe("export_folder IPC contract (F31)", () => {
  it("picks, writes raw bytes with the token, path and rule in headers, releases", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ token: "t1", path: "/Users/me/Exports" })
      .mockResolvedValueOnce({ status: "written", path: "Sub/Plan 2.png" })
      .mockResolvedValueOnce(undefined);
    const repo = new DesktopVaultRepository({ invoke });
    const { pickExportFolder, writeExportFile, releaseExportFolder } = repo;
    await expect(pickExportFolder()).resolves.toEqual({
      token: "t1",
      path: "/Users/me/Exports",
    });
    const bytes = new Uint8Array([1, 2]);
    await expect(
      writeExportFile("t1", "Sub/Plan ✓.png", bytes, "keep_both"),
    ).resolves.toEqual({ status: "written", path: "Sub/Plan 2.png" });
    expect(invoke.mock.calls[0][0]).toBe("export_folder_pick");
    const [command, body, options] = invoke.mock.calls[1];
    expect(command).toBe("export_folder_write");
    expect(body).toBe(bytes);
    expect(options.headers).toEqual({
      "x-export-token": "t1",
      "x-file-name": encodeURIComponent("Sub/Plan ✓.png"),
      "x-existing": "keep_both",
    });
    await releaseExportFolder("t1");
    expect(invoke.mock.calls[2]).toEqual([
      "export_folder_release",
      { token: "t1" },
    ]);
  });
});
