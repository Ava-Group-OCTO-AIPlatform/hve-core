---
title: advisor-checkpoints
description: "Advisor consultation checkpoints used during research, planning, implementation, and review (rpi-research, rpi-plan, rpi-implement, rpi-review, code-review) when the host exposes the server-side advisor tool, as Claude Code does with an advisor model set. Calls the advisor before each RPI loop hands off its result; does nothing in hosts without the advisor tool, such as GitHub Copilot."
sidebar_position: 8
author: Ava-Group-OCTO-AIPlatform
ms.date: 2026-11-11
ms.topic: reference
keywords:
  - skill
  - shared
  - advisor-checkpoints
---

<!-- BEGIN AUTO-GENERATED: metadata -->
| Field       | Value                                       |
|-------------|---------------------------------------------|
| Kind        | skill                                       |
| Source      | `.github/skills/shared/advisor-checkpoints` |
| Invocation  | Loaded on demand by referencing agents      |
| Interactive | No                                          |
<!-- END AUTO-GENERATED: metadata -->

## What it does

<!-- BEGIN AUTO-GENERATED: overview -->
Advisor consultation checkpoints used during research, planning, implementation, and review (rpi-research, rpi-plan, rpi-implement, rpi-review, code-review) when the host exposes the server-side advisor tool, as Claude Code does with an advisor model set. Calls the advisor before each RPI loop hands off its result; does nothing in hosts without the advisor tool, such as GitHub Copilot.
<!-- END AUTO-GENERATED: overview -->

## When to use it

The RPI skills activate any skill whose description says it is used during
their phase. In Claude Code (desktop, web, or the VS Code extension) with an
advisor model set, for example `/advisor opus`, this skill makes the session
consult the advisor before each loop hands off its result: the research
recommendation, the plan, the first edit, a check that fails twice, the end of
implementation, the review verdict, and the rework scope. In GitHub Copilot,
or in Claude Code without an advisor, it does nothing.

## Example usage

You set `/advisor opus` and run `/rpi` on Sonnet to add a field to an API
route. Before the first edit the agent consults the advisor, which points out a
consumer the plan missed; the agent confirms it in source and adds a validation
step. Before handing off to review it consults again. The changes log records
`Advisor: I1 consulted; outcome: followed` and
`Advisor: I3 consulted; outcome: followed`.
