---
title: AI and guidance
order: 5
---

# AI and guidance

What the AI surfaces can and can't do for you.

## The chat panel

Open with `⌘J` (or the sparkles button in the bottom right). The panel is context-aware: it knows which workspace, project, document, and text selection you're focused on, and assembles a retrieval block from the document's dependency neighbours, semantic-search matches, and recent unresolved comment threads.

You can ask it:

- **Spec questions** — "what does the API spec say about pagination?" — it'll call `searchSpecs` / `getDocument` / `getDependencies` and answer with citations.
- **Refinement help** — "tighten this paragraph" / "rewrite this as bullets" — it'll call `proposeEdit` and surface a Suggestion card. Clicking "Create suggestion" routes through the normal Suggestion path; you accept or reject like any human suggestion.
- **Navigation help** — "what should I do next?" — see Guidance mode below.

## Guidance mode

When you open the panel on an empty project (or with an empty chat history), the bot starts in **guidance mode**. The system prompt is tuned for onboarding: the bot is told it's "the most efficient ForgeSpecs user the team has", and its job is to read your project state and point you at the highest-value next action.

In guidance mode the bot uses two extra tools:

- **getOnboardingState** — reads the same signals the Next Steps card on the project landing reads (do you have a workspace? a project? have you imported a repo? has any doc been reviewed? approved?). Always called before the bot's first suggestion of a session.
- **proposeAction** — like `proposeEdit`, but for non-doc state changes (create a project, create a document, start a repo ingest, change a status). The bot fills in the intent; the panel renders a confirmation card; you click "Accept" to execute, and the action runs through the normal RBAC-gated server action.

## Guardrails

The bot has no surface area beyond what you have:

1. Every read tool RBAC-scopes its results to documents you can see.
2. Every write goes through a confirmation card, then through a `withPermission`-wrapped server action. The bot cannot bypass permissions, rate limits, or audit logging.
3. The system prompt instructs the bot to refuse off-topic questions ("I can only help with ForgeSpecs") and to never claim it did something you haven't confirmed.
4. The proposable actions are a fixed, small set: `createProject`, `createDocument`, `startRepoIngest`, `changeDocumentStatus`, `navigate`. There is no `deleteAnything` action, no bulk-edit action, no run-arbitrary-server-code action.

## When AI is not configured

If `OPENROUTER_API_KEY` is unset on the server, the chat panel shows an "AI not configured" banner instead of an input. The Next Steps card on the project page still works (it doesn't call AI). The `/guide` pages are fully static. The ingest flow's verbatim pass still runs without AI; only the synthesis pass is skipped.

So a key-less install still onboards usefully — you just write the synthesized docs yourself.
