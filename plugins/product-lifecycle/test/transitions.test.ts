import { test } from "node:test";
import assert from "node:assert/strict";
import { CR_STATUSES, CR_TRANSITIONS, STAGES, STAGE_GATES } from "../src/shared/types.ts";

test("change-request state machine only references known states and implemented is terminal", () => {
  for (const from of CR_STATUSES) {
    for (const to of CR_TRANSITIONS[from]) assert.ok(CR_STATUSES.includes(to), `${from} -> ${to}`);
  }
  assert.deepEqual(CR_TRANSITIONS.implemented, []);
  assert.ok(CR_TRANSITIONS.draft.includes("submitted"));
  assert.ok(CR_TRANSITIONS.under_review.includes("approved") && CR_TRANSITIONS.under_review.includes("rejected"));
  assert.ok(!CR_TRANSITIONS.draft.includes("approved"), "cannot approve a draft directly");
});

test("every lifecycle stage has exit gates", () => {
  for (const s of STAGES) assert.ok(STAGE_GATES[s].length >= 3, s);
});
