# Notes

## Time spent

1 hour 20 minutes.

## What I did

- Replaced the dependency-only scheduler with an OR-Tools CP-SAT model that minimizes the finish day while enforcing dependencies and one-task-at-a-time owner constraints.
- Added cycle detection, strict request/review schemas, clear 4xx responses, quote verification, model-output retries, and atomic review file writes.
- Expanded the backend tests to cover owner conflicts, parallel work, cycles, invalid input, unknown plans, quote validation, retries, AI configuration, and the health endpoint. The suite has 18 passing tests, and the supplied contract checks pass.
- Reworked the interface around the officer's decision: deadline status, finish metrics, findings, editable tasks, dependency controls, recalculation feedback, and source evidence. I followed `BRAND.md` and added responsive, keyboard-accessible loading and error states.
- Added a reproducible Docker deployment configuration and a Render health check.

## What I cut and why

I kept edits in the browser session instead of adding persistence, accounts, or revision history. I also left out a Gantt view and document upload so I could prioritize scheduling correctness, review validation, and the main decision flow.

## What is not ready

The public deployment URL still needs to be created. I did not regenerate the three stored sample reviews with a live model; the starter `lantern-festival.json` contains a quote that does not match the plan verbatim. I left it unchanged because the assignment requires those files to be produced by `./review`, not edited by hand.

## What I would do next and a rough estimate

- Run the three sample plans through the configured model and inspect the results: 30–45 minutes.
- Deploy the Docker service, run the contract checks against its URL, and perform a final mobile/accessibility pass: 30–45 minutes.
- Add persisted review revisions and a compact schedule timeline: 3–4 hours.
- Add an MCP connector for the council's document system (for example Google Drive or SharePoint) so officers can open a plan from its existing location, run the review, and link the decision back to the source document: 1–2 days, depending on the provider and authentication requirements.

## How I used AI tools

I used Codex to inspect the starter, implement the scheduler and validation layers, refine the UI, and propose tests. I checked the work with pytest, the supplied contract checker, TypeScript/Vite production builds, direct API requests, and browser screenshots. I reviewed the generated code and adjusted the interaction details manually rather than accepting changes without verification.

## Environment variables my review command needs

- `DEEPSEEK_API_KEY` — required to run `./review` or the in-app AI review. It is server-side only.
- `REVIEW_MODEL` — optional; defaults to `deepseek-flash`.
