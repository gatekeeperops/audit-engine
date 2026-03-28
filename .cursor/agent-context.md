# Agent Context

## 1) What we built so far
- Created a comprehensive Trello critical user-flows test plan at `specs/trello-test-plan.md`.
- Generated the first Playwright test for section `1.1` (Create a New Board) at `tests/trello/board/board-create-standard.spec.ts`.

## 2) The approach that works
The working loop in this repo/environment is:
1. Write the Playwright TypeScript test (or generate a draft).
2. Run it against the authenticated Trello UI using the saved session.
3. Fix selectors by inspecting the live DOM/Playwright snapshot when assertions fail.
4. Re-run the test until it passes.

## 3) Session file location
- `reports/session/state.json`

## 4) Test plan location
- `specs/trello-test-plan.md`

## 5) What tests are done
- `tests/trello/board/board-create-standard.spec.ts` (passing)
- `tests/trello/lists/list-add.spec.ts` (passing)
- `tests/trello/cards/card-create-open.spec.ts` (passing)
- `tests/trello/cards/card-edit-basic.spec.ts` (passing)

## 6) What tests need to be generated next
Next sections/tests to generate (per the test plan):
- `4.1` (Not in Trello plan text as provided; collaboration suite starts at `Collaboration Features` in the plan)
- `5.1` (Board/Workspace Settings flows; as provided, “Settings and Account Management” suite begins with board settings)

If you want this list mapped to exact filenames/paths from the test plan, tell me and I’ll align them precisely.

