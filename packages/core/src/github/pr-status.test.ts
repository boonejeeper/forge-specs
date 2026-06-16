import { describe, expect, it } from "vitest";

import {
  interpretPullRequestEvent,
  parsePrUrl,
  prStateFromPayload,
} from "./pr-status";

describe("github pr-status", () => {
  it("maps merged PR to MERGED", () => {
    expect(prStateFromPayload({ state: "closed", merged: true })).toEqual({
      state: "MERGED",
      merged: true,
    });
    expect(
      prStateFromPayload({ state: "closed", merged_at: "2024-01-01T00:00:00Z" }),
    ).toEqual({ state: "MERGED", merged: true });
  });

  it("maps draft PR to DRAFT", () => {
    expect(prStateFromPayload({ state: "open", draft: true })).toEqual({
      state: "DRAFT",
      merged: false,
    });
  });

  it("maps open / closed", () => {
    expect(prStateFromPayload({ state: "open" })).toEqual({
      state: "OPEN",
      merged: false,
    });
    expect(prStateFromPayload({ state: "closed" })).toEqual({
      state: "CLOSED",
      merged: false,
    });
  });

  it("parses PR URLs", () => {
    expect(parsePrUrl("https://github.com/acme/widgets/pull/42")).toEqual({
      owner: "acme",
      repo: "widgets",
      number: 42,
    });
    expect(parsePrUrl("not a url")).toBeNull();
    expect(parsePrUrl("https://github.com/acme/widgets/issues/42")).toBeNull();
  });

  it("interprets a full webhook payload", () => {
    const event = interpretPullRequestEvent({
      action: "closed",
      pull_request: {
        number: 7,
        html_url: "https://github.com/acme/widgets/pull/7",
        title: "Add feature",
        state: "closed",
        merged: true,
        merged_at: "2024-01-01T00:00:00Z",
      },
      repository: { name: "widgets", owner: { login: "acme" } },
    });
    expect(event).toEqual({
      ref: { owner: "acme", repo: "widgets", number: 7 },
      state: "MERGED",
      merged: true,
      title: "Add feature",
      url: "https://github.com/acme/widgets/pull/7",
    });
  });

  it("falls back to repository.full_name", () => {
    const event = interpretPullRequestEvent({
      pull_request: { number: 3, state: "open" },
      repository: { full_name: "octo/cat" },
    });
    expect(event?.ref).toEqual({ owner: "octo", repo: "cat", number: 3 });
  });

  it("returns null for incomplete payloads", () => {
    expect(interpretPullRequestEvent({})).toBeNull();
    expect(
      interpretPullRequestEvent({ pull_request: { state: "open" } }),
    ).toBeNull();
  });
});
