---
title: Getting started
order: 1
---

# Getting started

The first five minutes of a fresh account.

## Sign up

Hit `/signup` and create an account with email + password, GitHub, Google, or your org SSO. If your server has SSO configured you'll see a button per provider; if not, just use email/password.

There is no email verification step in the default install — you're in immediately.

## Create a workspace

A **workspace** is the tenancy boundary: members, billing (when applicable), and a set of projects all live inside one. After signup you land on `/welcome` with a single "Create workspace" button. Click it and pick a name — the slug is derived automatically.

You'll usually have one workspace per team. Larger orgs sometimes have one per business unit.

## Create a project

Inside a workspace, a **project** is the unit a codebase or product line maps to. Each project has its own spec tree (documents grouped by type) and its own GitHub repo binding (optional).

You can have many projects per workspace. From the sidebar's "Projects" header, click `+` to add one.

## Pick how to author

You now have an empty project. Two reasonable paths:

1. **Start from existing code** — point ForgeSpecs at the repo (local path or GitHub) and let the ingest flow generate a clean canonical doc set. See **[Import from a repo](/guide/import-from-repo)**.
2. **Author from scratch** — use the `+` in the spec tree to create your first Vision, then a PRD, then RFCs as you flesh out the design. See **[Authoring](/guide/authoring)**.

Most teams do both: ingest first to bootstrap, then keep authoring as the system evolves.

## Use the AI assistant

`⌘J` opens the AI panel. With a fresh project it'll show you a quick "What should I do next?" prompt — clicking that gets you a state-aware recommendation. See **[AI and guidance](/guide/ai-and-guidance)** for the full surface.
