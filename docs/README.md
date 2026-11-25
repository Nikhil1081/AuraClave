# AuraClave — Milestone 0 Deliverables

**Purpose:** Establish an evidence-led baseline and an implementation-ready target design before changing production code.

**Product direction:** Enterprise collaboration and communication platform with multilingual, AI-assisted meetings. India and global markets. Public launch after production hardening.

## Contents

1. `docs/architecture/CURRENT_STATE_AUDIT.md` — known repository baseline, risks, and audit checklist.
2. `docs/architecture/TARGET_ARCHITECTURE.md` — target system, module boundaries, runtime flows, deployment topology, and ADRs.
3. `docs/architecture/DATABASE_DESIGN.md` — PostgreSQL logical schema, constraints, indexes, lifecycle and migration plan.
4. `docs/security/SECURITY_THREAT_MODEL.md` — assets, trust boundaries, threats, controls, launch-blocking requirements.
5. `docs/roadmap/IMPLEMENTATION_ROADMAP.md` — sequenced milestones, deliverables, acceptance criteria, tests, and release gates.

## Status and evidence convention

- **Known:** Supported by repository inspection notes available at preparation time.
- **Proposed:** A target design decision, not yet implemented.
- **Verify:** Must be confirmed against the current default branch, deployed environments, or provider contracts before implementation.
- **P0:** Must be resolved before public launch; some P0 issues should be fixed before any external pilot.

This pack is a design deliverable, not a claim that the repository has been modified or that any control is already deployed. Re-run the repository audit against the current default branch before treating the baseline as complete.

## First actions

1. Confirm the default branch and current commit.
2. Re-run the verification checklist in the current-state audit.
3. Approve the identity-provider decision and database migration strategy.
4. Create a protected implementation branch and baseline CI.
5. Start Milestone 1 only after the Milestone 0 exit criteria are signed off.
