---
steps: [implement, alignment-audit, smoke-test, framework-review, fix-committable, red-team, fix-and-smoke, commit]
maxLaps: 12
---

# Audited Phase Implementation

Implement one phase of a plan, then put it through alignment, framework, and red-team audits with
triage gates before committing. One lap = one phase; loop to start the next phase, or finish when
the plan has no phases left. Several steps loop back internally with cycleGoto when a gate finds
real issues.

## implement

Implement the phase. /coding skill hygiene. Complex code -> handle yourself. Have a team? Delegate
to team agents only if the task is so simple they cannot fail.

Advance when the phase is implemented.

## alignment-audit

Plan alignment audit. Dispatch Agent(opus) -> compare the implementation vs the questionnaire and
plan.md. Report only, no edits. The agent runs its own `git diff` (no paste; the fresh-diff rule).

Triage gate: classify each finding as real deviation vs plan ambiguity / intentional refinement.
A confident tone is not evidence; verify against the code.

Advance to the smoke test.

## smoke-test

Perform smoke tests (run editor/game instances, introspection checks, screenshots, etc). Fix real
misalignments. No commit. Have a team? If it is their role, ask them to unit-test or smoke run.

Alignment loop: if you fixed anything, cycleGoto back to `alignment-audit`. Else advance.

## framework-review

/framework-first-design skill. Agent(opus) -> catch code crust, antipatterns, dupes, pain points,
whatever. Run the triage gate: real gap vs overcautious / out-of-scope / hallucinated.

Advance to fix the committable scope.

## fix-committable

Fix the committable scope, most significant first.

Advance to the red team.

## red-team

Red team. Pick 4 audit angles to vet the implementation for gaps. Dispatch 4 parallel Agent(opus),
one per angle:

- Each gets: the issue/finding context + their angle.
- Report only, no edits.
- The fresh-diff rule applies.

Triage gate each report on arrival (categories from framework-review).

Advance.

## fix-and-smoke

After all return, fix the real issues. No commit yet. Watch out for: yes-manning, scope creep,
drift from codebase patterns. Then perform smoke tests again.

Red team loop: if you fixed any red-team issues, cycleGoto back to `red-team` until clean. Else advance.

## commit

Committable chunk: update docs -> gitStage + gitCommit.

Framework loop: if framework-first issues remain, cycleGoto back to `framework-review`.

This is the end of a lap. At the checkpoint (the phase loop):

- Unfinished phases left in plan.md -> decision `loop` to start the next phase from `implement`.
- All phases done -> decision `done`.
- A critical blocker -> decision `critical-stop`.
