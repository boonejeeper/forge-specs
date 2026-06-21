---
title: Reviews and status
order: 4
---

# Reviews and status

How a doc moves from rough draft to approved spec.

## The status state machine

Every document has a status that moves through a small state machine:

- **DRAFT** — being written. Anyone with `doc.edit` can change anything.
- **REVIEW** — feature-complete enough for review. Comments, suggestions, and Review records can be attached. Edits still permitted.
- **APPROVED** — at least one APPROVE Review has been recorded on the current version. Further edits move the doc back to REVIEW (or DRAFT) automatically.
- **IMPLEMENTING** — the team has started building against this spec. Status flag only.
- **IMPLEMENTED** — done. Snapshotted version becomes the historical anchor.
- **DEPRECATED** — superseded or no longer relevant. Kept for the audit trail.

Only certain transitions are valid (e.g. you cannot jump from DRAFT to IMPLEMENTING). Approving requires the role `ARCHITECT` or `OWNER`, and at least one approving Review pinned to the current version.

## Suggestions

A **suggestion** is a track-changes proposal — a `jsondiffpatch` delta against block JSON, plus a rationale. Reviewers create them by selecting text and using the "Suggest edit" toolbar, or by asking the AI to refine a passage (the chat panel's `proposeEdit` flow). Authors then accept or reject; accepting applies the delta to the document.

The AI never edits docs directly — it always produces a Suggestion you review. This keeps the audit trail clean and avoids surprise edits.

## Comments

Threaded comments attach to text ranges. Selection anchors are Yjs relative positions, so the anchor follows the text even if surrounding paragraphs are edited.

## Reviews

A **Review** record is the formal sign-off: `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`. Reviews pin to the version they were recorded on, so editing the doc after a review invalidates the approval (the doc moves back to REVIEW automatically).

To request a review, change the document's status from DRAFT to REVIEW. Reviewers in the project will see it in their inbox.

## The inbox

The Inbox (left sidebar → Inbox) shows everything that needs your attention: review requests, mentions, suggestions awaiting your accept/reject, status changes on docs you authored. The unread count is the badge on the sidebar.
