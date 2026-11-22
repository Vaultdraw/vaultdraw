import { describe, expect, it } from "vitest";

import {
  BAR_FULL,
  BAR_MEDIUM,
  EMPTY_HINT,
  MAX_IMAGE_BYTES,
  barLevel,
  checkImages,
  contextChip,
  effortBars,
  helperKind,
  imageFilesOf,
  imageNote,
  shortModelLabel,
} from "../src/composerLogic";
import { imageProblem } from "../src/imageFiles";
import { lastImages, wireMessages } from "../src/images";
import { buildRequest, type ProviderConfig } from "../src/providers";

const file = (name: string, type: string, size = 10) => ({ name, type, size });

describe("the toolbar", () => {
  it("shortens by width: full, then a shorter model name, then the shortest", () => {
    expect(barLevel(400)).toBe(0);
    expect(barLevel(BAR_FULL)).toBe(0);
    expect(barLevel(BAR_FULL - 1)).toBe(1);
    expect(barLevel(BAR_MEDIUM)).toBe(1);
    expect(barLevel(BAR_MEDIUM - 1)).toBe(2);
    expect(barLevel(0)).toBe(0); // no layout (tests, hidden panel): full
    expect(barLevel(null)).toBe(0);
  });

  it.each([
    ["Default (recommended)", 16, "Default"],
    ["Sonnet 4.5", 16, "Sonnet 4.5"],
    ["Claude Sonnet 4.5 (your subscription)", 16, "Sonnet 4.5"],
    ["Gemini 2.5 Pro Preview Thinking", 16, "Gemini 2.5 Pro"],
    ["Gemini 2.5 Pro Preview Thinking", 9, "Gemini"],
    ["Supercalifragilistic", 9, "Supercalifragilistic"],
    ["", 16, "Default"],
  ])("model label %j at %i is %j (whole words only)", (label, max, want) => {
    expect(shortModelLabel(label, max)).toBe(want);
  });

  it("never cuts a word in half, for any label and any limit", () => {
    for (const label of [
      "Opus 4.1 (recommended)",
      "GPT-5 Codex High",
      "Llama 3.2 Vision 11B",
    ]) {
      for (let max = 1; max < 30; max++) {
        const out = shortModelLabel(label, max);
        expect(label.replace(/\s*\(recommended\)/, "").startsWith(out)).toBe(
          true,
        );
        expect(label).toContain(out.split(" ").at(-1)!);
      }
    }
  });

  it("effort bars: none for the default, spread over three for longer lists", () => {
    const three = ["low", "medium", "high"];
    expect(effortBars(three, "")).toBe(0);
    expect(effortBars(three, "low")).toBe(1);
    expect(effortBars(three, "high")).toBe(3);
    const five = ["low", "medium", "high", "xhigh", "max"];
    expect(five.map((e) => effortBars(five, e))).toEqual([1, 1, 2, 2, 3]);
    expect(effortBars([], "low")).toBe(0);
    expect(effortBars(three, "weird")).toBe(0);
  });
});

describe("the context chip", () => {
  it("shows nothing for the default and when the choice does not matter", () => {
    expect(contextChip("auto", true)).toBeNull();
    expect(contextChip("drawing", false)).toBeNull();
  });
  it("names a non-default choice", () => {
    expect(contextChip("drawing", true)).toBe("Whole drawing");
    expect(contextChip("selection", true)).toBe("Only selection");
    expect(contextChip("none", true)).toBe("No drawing");
  });
});

describe("pasted and dropped files", () => {
  it("accepts PNG, JPEG, GIF and WebP up to 5 MB, four at most", () => {
    const r = checkImages(0, [
      file("a.png", "image/png"),
      file("b.jpg", "image/jpeg"),
      file("c.gif", "image/gif"),
      file("d.webp", "image/webp", MAX_IMAGE_BYTES),
    ]);
    expect(r.accept).toEqual([0, 1, 2, 3]);
    expect(r.problems).toEqual([]);
  });
  it("refuses other types, big files and anything past four, in plain words, once each", () => {
    const r = checkImages(3, [
      file("x.svg", "image/svg+xml"),
      file("huge.png", "image/png", MAX_IMAGE_BYTES + 1),
      file("ok.png", "image/png"),
      file("one-too-many.png", "image/png"),
      file("two-too-many.png", "image/png"),
    ]);
    expect(r.accept).toEqual([2]);
    expect(r.problems).toEqual([
      "x.svg is not a PNG, JPEG, GIF or WebP image.",
      "huge.png is larger than 5 MB.",
      "At most 4 images can be sent at once.",
    ]);
  });
  it("picks the image files out of a paste or drop", () => {
    const f = (n: string, t: string) => new File(["x"], n, { type: t });
    expect(
      imageFilesOf([
        f("a.png", "image/png"),
        f("n.txt", "text/plain"),
        f("b.JPG", ""),
      ]).map((x) => x.name),
    ).toEqual(["a.png", "b.JPG"]);
    expect(imageFilesOf(null)).toEqual([]);
  });
  it("says so when a provider cannot be sure to read images", () => {
    expect(imageNote("ollama")).toMatch(/can see images/);
    expect(imageNote("claude-cli")).toBeNull();
  });
  it("API providers have a size budget (the app's request cap is 2 MiB); command lines do not", () => {
    const big = [
      {
        name: "a",
        mime: "image/png" as const,
        data: "A".repeat(1_600_000),
        size: 1,
      },
    ];
    expect(imageProblem("anthropic", big)).toMatch(/too large/);
    expect(imageProblem("openai", [])).toBeNull();
    expect(imageProblem("claude-cli", big)).toBeNull();
    expect(imageProblem("codex-cli", big)).toBeNull();
  });
});

describe("the question box", () => {
  it("shows the context list after @, and nothing for plain text or a leading / (there is no slash list)", () => {
    expect(helperKind("/")).toBeNull();
    expect(helperKind("/ed")).toBeNull();
    expect(helperKind("look at @sel")).toBe("at");
    expect(helperKind("hello")).toBeNull();
    expect(helperKind("a /b")).toBeNull();
    expect(helperKind("")).toBeNull();
  });
  it("the empty state is one line that names @ and no slash", () => {
    expect(EMPTY_HINT).toBe(
      "Ask a question, have a topic explained on the page, or say what to change. @ chooses what is sent.",
    );
    expect(EMPTY_HINT).not.toContain("/");
  });
});

describe("images in each provider's request", () => {
  const img = [{ mime: "image/png", data: "QUJD" }];
  const msgs = [
    { role: "user" as const, content: "old" },
    { role: "user" as const, content: "look", images: img },
  ];
  const cfg = (provider: ProviderConfig["provider"]): ProviderConfig => ({
    provider,
    model: "m",
    effort: "",
    baseUrl: "",
    timeoutMs: 1000,
    hasKey: true,
  });
  it("Anthropic: image blocks before the text, only on the message that has them", () => {
    const w = wireMessages("anthropic", msgs) as any[];
    expect(w[0]).toEqual({ role: "user", content: "old" });
    expect(w[1].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "QUJD" },
    });
    expect(w[1].content[1]).toEqual({ type: "text", text: "look" });
    expect(
      JSON.parse(buildRequest(cfg("anthropic"), "sys", msgs).body!).messages[1]
        .content[0].type,
    ).toBe("image");
  });
  it("OpenAI: image_url with a data address", () => {
    const body = JSON.parse(buildRequest(cfg("openai"), "sys", msgs).body!);
    expect(body.messages.at(-1).content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,QUJD" },
    });
  });
  it("Ollama: an images list of base64 on the message", () => {
    const body = JSON.parse(buildRequest(cfg("ollama"), "sys", msgs).body!);
    expect(body.messages.at(-1)).toEqual({
      role: "user",
      content: "look",
      images: ["QUJD"],
    });
  });
  it("messages without images are unchanged, and a command line takes the newest message's images", () => {
    const plain = [{ role: "user" as const, content: "hi" }];
    expect(wireMessages("openai", plain)).toEqual(plain);
    expect(lastImages(msgs)).toEqual(img);
    expect(lastImages(plain)).toEqual([]);
  });
});
