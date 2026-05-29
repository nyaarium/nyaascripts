---
steps: [propose, audit, triage, rethink]
maxLaps: 8
---

# Idea Refinement

A convergence loop for hardening a plan or idea. Each lap proposes, audits from multiple angles,
triages the findings, and rethinks, looping until the plan feels solid. The subject doc is the
plan being refined; its body churns each lap while these steps stay fixed.

## propose

Propose or refine the plan. Write the current state to `./temp/plan.md`.

When done, conclude this step with cycleNext.

## audit

Analysis only, no edits: pick 4 audit angles to vet the idea for gaps, blockers, concerns. Dispatch
4 parallel Agent(opus), one per angle:

- Point to plan.md.
- Give the angle. Report only, no edits.

When all four are dispatched and returned, conclude this step with cycleNext.

## triage

Triage each report on arrival. Real gap vs overcautious / out-of-scope / hallucinated? Re-think.

Conclude this step with cycleNext once every report has been classified.

## rethink

After all return, rethink. Plan changed? Update plan.md. Watch out for: yes-manning, scope creep,
heavy drift (ask the human on large drifts).

This is the last step, so it ends the lap. Conclude it with cycleNext (because it is the last step,
cycleNext returns lapEnd and points you at cycleCheckpoint), then call
cycleCheckpoint({ plan, decision, summary }):

- Plan feels solid -> `done`, and give a final report to the channel.
- A critical issue you cannot resolve in-loop -> `critical-stop` (you may /questionaire again).
- Otherwise -> `loop` to refine for another lap.
