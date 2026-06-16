import { describe, expect, it } from "vitest";

import { mentionToken, parseMentions, renderMentionsPlain } from "./mentions";

describe("parseMentions", () => {
  it("parses a user mention", () => {
    expect(parseMentions("hi @[Alice](user:clx1) there")).toEqual([
      { kind: "user", userId: "clx1", label: "Alice" },
    ]);
  });

  it("parses an agent mention", () => {
    expect(parseMentions("@[architect](agent:architect) please")).toEqual([
      { kind: "agent", agentName: "architect", label: "architect" },
    ]);
  });

  it("parses multiple distinct mentions", () => {
    const parsed = parseMentions("@[A](user:1) and @[B](user:2)");
    expect(parsed).toHaveLength(2);
  });

  it("de-duplicates the same target", () => {
    const parsed = parseMentions("@[A](user:1) @[A again](user:1)");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ kind: "user", userId: "1", label: "A" });
  });

  it("returns [] when there are no mentions", () => {
    expect(parseMentions("plain comment")).toEqual([]);
  });
});

describe("mentionToken / renderMentionsPlain", () => {
  it("builds a parseable token", () => {
    const tok = mentionToken("user", "clx1", "Alice");
    expect(parseMentions(tok)).toEqual([
      { kind: "user", userId: "clx1", label: "Alice" },
    ]);
  });

  it("renders tokens to plain @label", () => {
    expect(renderMentionsPlain("hi @[Alice](user:1)!")).toBe("hi @Alice!");
  });
});
