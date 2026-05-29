---
steps: [implement, align, framework, red-team, commit]
maxLaps: 12
---

# Audited Phase Implementation

Implement one phase of a plan, then harden it through alignment, framework, and red-team passes
before committing. One lap = one phase: loop to start the next phase, or finish when the plan has
no phases left. Each audit pass analyzes and triages with NO edits first, then applies only the
real findings.

## implement

Implement the phase. /coding skill hygiene. Complex code -> handle yourself. Have a team? Delegate
to team agents only if the task is so simple they cannot fail.

Conclude this step with cycleNext once the phase is implemented.

## align

Analysis first, no edits: plan alignment audit. Dispatch Agent(opus) -> compare the implementation
vs the questionnaire and plan.md. Report only, no edits. The agent runs its own `git diff` (no
paste; the fresh-diff rule). Triage gate: classify each finding as real deviation vs plan ambiguity
/ intentional refinement. A confident tone is not evidence; verify against the code.

Then fix the real misalignments and run smoke tests (run editor/game instances, introspection
checks, screenshots, etc). No commit. Have a team? If it is their role, ask them to unit-test or
smoke run. If a fix changed anything, re-run the audit; repeat until it comes back clean.

Conclude this step with cycleNext when alignment is clean.

## framework

Analysis first, no edits: /framework-first-design skill. Dispatch Agent(opus) -> catch code crust,
antipatterns, dupes, pain points, whatever. Triage gate: real gap vs overcautious / out-of-scope /
hallucinated.

Then apply only the real findings, most significant first, scoped to one coherent committable
chunk. No commit yet.

Conclude this step with cycleNext.

## red-team

Analysis first, no edits: pick 4 audit angles to vet the implementation for gaps. Dispatch 4
parallel Agent(opus), one per angle:

- Each gets: the issue/finding context + their angle.
- Report only, no edits.
- The fresh-diff rule applies.

Triage gate each report on arrival: real gap vs overcautious / out-of-scope / hallucinated.

Then fix the real issues and run smoke tests again. No commit yet. Watch out for: yes-manning,
scope creep, drift from codebase patterns. If you fixed anything, re-run the red team; repeat until
it comes back clean.

Conclude this step with cycleNext when the red team is clean.

## commit

Committable chunk: update docs -> gitStage + gitCommit.

Framework loop: if framework-first issues still remain, cycleGoto back to `framework` instead of
concluding.

This is the last step, so it ends the lap. Conclude it with cycleNext as usual; because it is the
last step, cycleNext returns lapEnd and points you at the checkpoint. Then call
cycleCheckpoint({ plan, decision, summary }) with the phase-loop decision:

- Unfinished phases left in plan.md -> `loop` (wraps back to `implement` to start the next phase).
- All phases done -> `done`.
- A critical blocker -> `critical-stop`.
