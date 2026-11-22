import { describe, expect, it, vi } from "vitest";

import {
  parseFixes,
  REVIEW_CHECKLIST,
  reviewOnce,
  type ReviewFix,
} from "../src/review";

const PNG = "data:image/png;base64,AAAA";
const fixReply = (id: string) =>
  `The label overlaps.\n\n\`\`\`vd edit\n{"ops":[{"op":"move","id":"${id}","dx":0,"dy":40}]}\n\`\`\`\n`;

const setup = (replies: string[], extra = {}) => {
  const render = vi.fn(async () => PNG);
  let n = 0;
  const ask = vi.fn(async (_img: string, _list: string) => {
    const r = replies[Math.min(n, replies.length - 1)];
    n++;
    return r;
  });
  const apply = vi.fn(async (_f: ReviewFix[]) => {});
  return { render, ask, apply, options: { render, ask, apply, ...extra } };
};

describe("REVIEW_CHECKLIST", () => {
  it("fits 250 tokens (chars / 4) and names every check", () => {
    expect(REVIEW_CHECKLIST.length / 4).toBeLessThanOrEqual(250);
    for (const word of [
      "Overlap",
      "Truncated",
      "Crossing",
      "Unlabelled",
      "16 px",
      "40 px",
      "Zone",
      "Contrast",
    ]) {
      expect(REVIEW_CHECKLIST).toContain(word);
    }
  });
});

describe("parseFixes", () => {
  it("reads every vd edit block and skips bad ones", () => {
    const reply = `${fixReply(
      "a",
    )}text\n~~~vd edit\n{"ops":[{"op":"delete","id":"b"}]}\n~~~\n\`\`\`vd edit\nnot json\n\`\`\`\n\`\`\`vd text\nhi\n\`\`\`\n\`\`\`vd edit\n{"ops":[]}\n\`\`\``;
    expect(parseFixes(reply)).toEqual([
      { ops: [{ op: "move", id: "a", dx: 0, dy: 40 }] },
      { ops: [{ op: "delete", id: "b" }] },
    ]);
  });

  it("returns nothing for prose", () => {
    expect(parseFixes("No issues.")).toEqual([]);
  });
});

describe("reviewOnce", () => {
  it("returns the fixes of a reply with issues and sends the picture and checklist", async () => {
    const s = setup([fixReply("a")]);
    const { apply: _skip, ...noApply } = s.options;
    const res = await reviewOnce(noApply);
    expect(s.ask).toHaveBeenCalledWith(PNG, REVIEW_CHECKLIST);
    expect(res.fixes).toEqual([
      { ops: [{ op: "move", id: "a", dx: 0, dy: 40 }] },
    ]);
    expect(res.rounds).toHaveLength(1);
    expect(res.stopped).toBe("once"); // no apply: a second picture would be the same
  });

  it('"no issues" stops after one round with no fixes', async () => {
    const s = setup(["No issues."]);
    const res = await reviewOnce(s.options);
    expect(res).toMatchObject({ fixes: [], stopped: "clean" });
    expect(s.render).toHaveBeenCalledTimes(1);
    expect(s.apply).not.toHaveBeenCalled();
  });

  it("applies the fixes, looks again, and stops when the second look is clean", async () => {
    const s = setup([fixReply("a"), "No issues."]);
    const res = await reviewOnce(s.options);
    expect(s.apply).toHaveBeenCalledTimes(1);
    expect(s.render).toHaveBeenCalledTimes(2);
    expect(res.stopped).toBe("clean");
    expect(res.fixes).toHaveLength(1);
  });

  it("stops at maxRounds (default 2) even when the model keeps finding issues", async () => {
    const s = setup([fixReply("a")]);
    const res = await reviewOnce(s.options);
    expect(s.ask).toHaveBeenCalledTimes(2);
    expect(res.rounds).toHaveLength(2);
    expect(res.stopped).toBe("capped");
    const one = setup([fixReply("a")], { maxRounds: 1 });
    await reviewOnce(one.options);
    expect(one.ask).toHaveBeenCalledTimes(1);
  });

  it("skips cleanly for a model without image support", async () => {
    const s = setup([fixReply("a")], { supportsImages: false });
    const res = await reviewOnce(s.options);
    expect(res).toEqual({ rounds: [], fixes: [], stopped: "no-images" });
    expect(s.render).not.toHaveBeenCalled();
    expect(s.ask).not.toHaveBeenCalled();
  });

  it("reports a failing render or model instead of throwing, keeping earlier fixes", async () => {
    const s = setup([fixReply("a")]);
    s.render
      .mockResolvedValueOnce(PNG)
      .mockRejectedValueOnce(new Error("no drawing"));
    const res = await reviewOnce(s.options);
    expect(res.stopped).toBe("error");
    expect(res.error).toBe("no drawing");
    expect(res.fixes).toHaveLength(1);
  });

  it("stops when cancelled", async () => {
    const s = setup([fixReply("a")], { cancelled: () => true });
    const res = await reviewOnce(s.options);
    expect(s.render).not.toHaveBeenCalled();
    expect(res.rounds).toEqual([]);
  });
});
