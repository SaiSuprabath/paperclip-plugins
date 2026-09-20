import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSchedule, WorkCalendar, levelResources, DEFAULT_CALENDAR } from "../src/shared/cpm.ts";

test("work calendar skips weekends", () => {
  const cal = new WorkCalendar("2026-09-21"); // Monday
  assert.equal(cal.toDate(0), "2026-09-21");
  assert.equal(cal.toDate(4), "2026-09-25"); // Friday
  assert.equal(cal.toDate(5), "2026-09-28"); // next Monday
  assert.equal(cal.toIndex("2026-09-26"), 5); // Saturday rounds forward to Monday
  assert.equal(cal.finishDate(0, 5), "2026-09-25");
});

test("classic CPM network yields correct critical path and float", () => {
  // A(3) -> B(2) -> D(4); A -> C(5) -> D. Critical: A, C, D (12 days). B has float 3.
  const r = computeSchedule(
    [
      { id: "A", duration: 3, predecessors: [] },
      { id: "B", duration: 2, predecessors: [{ id: "A", type: "FS", lag: 0 }] },
      { id: "C", duration: 5, predecessors: [{ id: "A", type: "FS", lag: 0 }] },
      { id: "D", duration: 4, predecessors: [{ id: "B", type: "FS", lag: 0 }, { id: "C", type: "FS", lag: 0 }] },
    ],
    "2026-09-21",
  );
  assert.deepEqual(r.criticalPath, ["A", "C", "D"]);
  assert.equal(r.durationDays, 12);
  assert.equal(r.tasks.get("B")!.totalFloat, 3);
  assert.equal(r.tasks.get("B")!.freeFloat, 3);
  assert.equal(r.tasks.get("D")!.start, "2026-10-01");
  assert.equal(r.tasks.get("D")!.finish, "2026-10-06");
  assert.equal(r.projectFinish, "2026-10-06");
});

test("SS and FF links and lags", () => {
  const r = computeSchedule(
    [
      { id: "A", duration: 4, predecessors: [] },
      { id: "B", duration: 2, predecessors: [{ id: "A", type: "SS", lag: 1 }] },
      { id: "C", duration: 3, predecessors: [{ id: "A", type: "FF", lag: 2 }] },
    ],
    "2026-09-21",
  );
  assert.equal(r.tasks.get("B")!.es, 1);
  assert.equal(r.tasks.get("C")!.ef, 6);
  assert.equal(r.tasks.get("C")!.es, 3);
});

test("cycles are detected and broken instead of hanging", () => {
  const r = computeSchedule(
    [
      { id: "A", duration: 1, predecessors: [{ id: "B", type: "FS", lag: 0 }] },
      { id: "B", duration: 1, predecessors: [{ id: "A", type: "FS", lag: 0 }] },
      { id: "C", duration: 1, predecessors: [] },
    ],
    "2026-09-21",
  );
  assert.equal(r.order.length, 3);
  assert.equal(r.cycles.length, 1);
  assert.ok(r.droppedLinks.length >= 1);
});

test("start-no-earlier-than constraint pushes a task and milestones have zero duration", () => {
  const r = computeSchedule(
    [
      { id: "A", duration: 2, predecessors: [] },
      { id: "M", duration: 0, predecessors: [{ id: "A", type: "FS", lag: 0 }], constraintType: "snet", constraintDate: "2026-10-05" },
    ],
    "2026-09-21",
  );
  assert.equal(r.tasks.get("M")!.start, "2026-10-05");
  assert.equal(r.tasks.get("M")!.finish, "2026-10-05");
});

test("resource leveling delays overlapping tasks on the same resource", () => {
  const tasks = [
    { id: "A", duration: 3, predecessors: [] },
    { id: "B", duration: 3, predecessors: [] },
  ];
  const delays = levelResources(
    tasks,
    "2026-09-21",
    DEFAULT_CALENDAR,
    [
      { taskId: "A", resourceId: "r1", unitsPct: 100, effortHours: null },
      { taskId: "B", resourceId: "r1", unitsPct: 100, effortHours: null },
    ],
    [{ id: "r1", capacityHoursPerDay: 8 }],
  );
  const total = [...delays.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 3);
});
