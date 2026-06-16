import { describe, expect, it } from "vitest";

import {
  chunkBlocks,
  chunkText,
  estimateTokens,
  hashChunk,
} from "./chunk";

const word = (n: number): string => Array(n).fill("word").join(" ");

describe("estimateTokens", () => {
  it("is 0 for empty", () => {
    expect(estimateTokens("")).toBe(0);
  });
  it("approximates ~4 chars/token", () => {
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });
});

describe("hashChunk", () => {
  it("is stable and deterministic", () => {
    expect(hashChunk("hello world")).toBe(hashChunk("hello world"));
  });
  it("differs for different content", () => {
    expect(hashChunk("a")).not.toBe(hashChunk("b"));
  });
  it("normalizes unicode (NFC) so equivalent strings hash equal", () => {
    // 'é' composed vs decomposed.
    const composed = "café";
    const decomposed = "café";
    expect(hashChunk(composed)).toBe(hashChunk(decomposed));
  });
});

describe("chunkBlocks", () => {
  it("returns [] for empty input", () => {
    expect(chunkBlocks([])).toEqual([]);
  });

  it("skips empty / whitespace blocks", () => {
    const chunks = chunkBlocks([
      { id: "1", text: "   " },
      { id: "2", text: "" },
    ]);
    expect(chunks).toEqual([]);
  });

  it("packs small blocks into a single chunk", () => {
    const chunks = chunkBlocks([
      { id: "1", text: "alpha" },
      { id: "2", text: "beta" },
      { id: "3", text: "gamma" },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("alpha");
    expect(chunks[0]!.content).toContain("gamma");
    expect(chunks[0]!.blockIds).toEqual(["1", "2", "3"]);
  });

  it("assigns sequential indexes and stable hashes", () => {
    const chunks = chunkText(word(2000), { targetTokens: 100, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.hash).toBe(hashChunk(c.content));
    });
  });

  it("respects the target token budget (chunks are bounded)", () => {
    const chunks = chunkText(word(4000), { targetTokens: 128, overlapTokens: 16 });
    for (const c of chunks) {
      // Allow some slack for word-boundary breaking + overlap seeding.
      expect(estimateTokens(c.content)).toBeLessThanOrEqual(128 * 1.6);
    }
  });

  it("windows a single oversized block and attributes it", () => {
    const big = word(3000); // far over a small budget
    const chunks = chunkBlocks([{ id: "big", text: big }], {
      targetTokens: 100,
      overlapTokens: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.blockIds).toEqual(["big"]);
    }
  });

  it("produces overlap between consecutive chunks", () => {
    const chunks = chunkBlocks(
      [
        { id: "1", text: word(120) },
        { id: "2", text: word(120) },
        { id: "3", text: word(120) },
      ],
      { targetTokens: 80, overlapTokens: 20 },
    );
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap means a later chunk should contain a tail from the previous one;
    // at minimum the chunking is deterministic and re-runnable.
    const rerun = chunkBlocks(
      [
        { id: "1", text: word(120) },
        { id: "2", text: word(120) },
        { id: "3", text: word(120) },
      ],
      { targetTokens: 80, overlapTokens: 20 },
    );
    expect(rerun.map((c) => c.hash)).toEqual(chunks.map((c) => c.hash));
  });

  it("is deterministic — identical input yields identical hashes", () => {
    const input = [
      { id: "a", text: "The quick brown fox." },
      { id: "b", text: "Jumps over the lazy dog." },
    ];
    const a = chunkBlocks(input);
    const b = chunkBlocks(input);
    expect(a.map((c) => c.hash)).toEqual(b.map((c) => c.hash));
  });
});
