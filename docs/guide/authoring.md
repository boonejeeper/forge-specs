---
title: Authoring
order: 3
---

# Authoring

Day-to-day editing in ForgeSpecs.

## The editor

ForgeSpecs uses a block editor — every paragraph, heading, list item, code block, callout, and diagram is a discrete block you can rearrange, link to, or comment on. Realtime collaboration is on by default: every editable document opens a Yjs collab room with awareness (cursors, selections, presence) shared across active editors.

The doc body is the source of truth for prose. The agent-readiness frontmatter at the top — `owner`, `version`, `implementation_state` — is a separate metadata block, edited via the Status / Owner / Version controls on the page header.

## Custom blocks

Beyond standard blocks (paragraphs, headings, bullets, numbered lists, quotes, tables), ForgeSpecs ships three spec-authoring blocks:

- **Mermaid** — type `/mermaid` to insert a Mermaid diagram. Edits live in the block's source; the rendered SVG is derived. There are also seed templates for common diagram types: `/sequence`, `/erd`, `/flow`, `/state`, etc.
- **Code** — type `/code` to insert a syntax-highlighted code block (Shiki). Click "Edit" to enter raw text mode, choose a language from the dropdown, click "Done" to re-render.
- **Callout** — type `/callout` for an admonition (info / warning / tip).

## Mentions

Type `@` to open the mention menu and pick a project member, or `@@` to mention an agent (e.g. `@@architect`). Agent mentions trigger an AI flow that produces a new TASK_PLAN document with the agent's plan attached.

## Dependencies

Spec documents are graph nodes. Use the "Dependencies" panel on the doc page header to add edges to other docs with one of five kinds: `IMPLEMENTS`, `REFERENCES`, `DERIVES_FROM`, `SUPERSEDES`, `BLOCKS`. The Graph view (per-project and per-doc) renders the full dependency tree, including transitive edges.

## Templates

The "+" menu in the spec tree includes a "From template…" option. Templates are reusable block trees (workspace-scoped, optionally shareable). The bundled templates cover a Vision, a PRD with acceptance criteria, an RFC with motivation/design/alternatives, and an ADR (the Michael Nygard format).

## Saving and history

Edits are saved automatically — debounced to ~800ms on single-player mode, and via Yjs compaction in collab mode. Every status transition snapshots a new `DocumentVersion` (if content changed since the last version); manual snapshots are available via the version controls.

The history view shows every snapshot, with a side-by-side diff against the previous version. You can restore any older version — restoration creates a new version on top, preserving the full chain.
