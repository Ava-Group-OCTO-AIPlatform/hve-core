---
title: openwiki-context
description: "Repository wiki lookup used during research, planning, and review (rpi-research, rpi-plan, rpi-review, code-review) when the repository has an openwiki/ folder or the openwiki MCP tools are available. Narrows which source files to read and maps dependents for change-impact analysis; wiki content is a claim to verify in source."
sidebar_position: 7
author: Ava-Group-OCTO-AIPlatform
ms.date: 2026-11-11
ms.topic: reference
keywords:
  - skill
  - shared
  - openwiki-context
---

<!-- BEGIN AUTO-GENERATED: metadata -->
| Field       | Value                                    |
|-------------|------------------------------------------|
| Kind        | skill                                    |
| Source      | `.github/skills/shared/openwiki-context` |
| Invocation  | Loaded on demand by referencing agents   |
| Interactive | No                                       |
<!-- END AUTO-GENERATED: metadata -->

## What it does

<!-- BEGIN AUTO-GENERATED: overview -->
Repository wiki lookup used during research, planning, and review (rpi-research, rpi-plan, rpi-review, code-review) when the repository has an openwiki/ folder or the openwiki MCP tools are available. Narrows which source files to read and maps dependents for change-impact analysis; wiki content is a claim to verify in source.
<!-- END AUTO-GENERATED: overview -->

## When to use it

The RPI research, planning, and review skills activate any skill whose
description says it is used during their phase. When the repository has an
OpenWiki (an `openwiki/` folder, or the openwiki MCP server), this skill makes
them look up the wiki first to pick which files to read and which dependents a
change can break. Without a wiki it records that it was skipped and does
nothing else.

## Example usage

You run `/rpi` to add a field to an API route. During research the agent
searches the wiki for the route, opens the handler, schema, and tests the wiki
names, and confirms each one in source before citing it. During planning it
looks up the route's consumers and adds a validation step for each confirmed
one. The research notes list the wiki sections as claims to verify, with a
`possibly stale` mark when those files changed after the wiki's last update.
