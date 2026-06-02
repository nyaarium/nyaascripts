---
steps: [implement, align, framework, red-team, commit]
maxLaps: 12
---

# Audited Phase Implementation

Implement one phase of a plan, then harden it through alignment, framework, and red-team passes
before committing. One lap = one phase. Each audit pass analyzes and triages with NO edits first,
then applies only the real findings.

## implement

Implement the phase. /coding skill hygiene. Complex code -> handle yourself. Have a team? Delegate
to team agents only if the task is so simple they cannot fail.

## align

Analysis first, no edits: plan alignment audit. Dispatch Agent(opus) -> compare the implementation
vs the questionnaire and the plan. Report only, no edits. The agent runs its own `git diff` (no
paste; the fresh-diff rule). Triage gate: real deviation vs plan ambiguity / intentional
refinement. A confident tone is not evidence; verify against the code.

Then fix the real misalignments and run smoke tests (run editor/game instances, introspection
checks, screenshots, etc). Have a team? If it is their role, ask them to unit-test or smoke run.
If a fix changed anything, re-run the audit; repeat until it comes back clean.

## framework

Analysis first, no edits: /framework-first-design skill. Dispatch Agent(opus) -> catch code crust,
antipatterns, dupes, pain points, whatever. Triage gate: real gap vs overcautious / out-of-scope /
hallucinated.

Then apply only the real findings, most significant first, scoped to one coherent committable chunk.

## red-team

Analysis first, no edits: pick audit angles to vet the implementation for gaps, and dispatch one
parallel Agent(opus) per angle. Scale breadth to change size (2 focused for a small delta, or more
than 4 for a massive rewrite):

- Each gets: the issue/finding context + their angle.
- Report only, no edits.
- The fresh-diff rule applies.

Triage gate each report on arrival: real gap vs overcautious / out-of-scope / hallucinated.

Then fix the real issues and run smoke tests again. Watch out for: yes-manning, scope creep, drift
from codebase patterns. If you fixed anything, re-run the red team; repeat until it comes back clean.

## commit

Update docs, then gitStage + gitCommit. If framework-first issues still remain, cycleGoto back to
`framework` instead of ending the lap.

Otherwise end the lap: call cycleCheckpoint with one of

- `loop` - unfinished phases left in the plan; starts the next phase
- `done` - all phases done
- `critical-stop` - a critical blocker
