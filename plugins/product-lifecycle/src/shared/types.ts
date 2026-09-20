export const STAGES = ["discovery", "definition", "development", "launch", "growth", "maturity", "sunset"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  discovery: "Discovery",
  definition: "Definition",
  development: "Development",
  launch: "Launch",
  growth: "Growth",
  maturity: "Maturity",
  sunset: "Sunset",
};

/** Default gate checklist a project must satisfy before moving to the next stage. */
export const STAGE_GATES: Record<Stage, string[]> = {
  discovery: ["Problem statement validated with users", "Market / competitor scan done", "Success metrics defined", "Business case approved"],
  definition: ["PRD / requirements signed off", "Scope baseline agreed", "Architecture & technical approach reviewed", "Roadmap and release plan published"],
  development: ["Sprint cadence running", "Definition of done agreed", "Quality gates (tests, review) in place", "Change control active"],
  launch: ["Go / no-go review passed", "Release notes & docs ready", "Support and rollback plan ready", "Launch metrics dashboard live"],
  growth: ["Adoption targets tracked", "Feedback loop into backlog", "Pricing / packaging reviewed", "Scaling risks assessed"],
  maturity: ["Cost to serve optimised", "Tech debt plan agreed", "Retention metrics stable", "Sunset criteria defined"],
  sunset: ["Customer migration plan", "Data retention & deletion plan", "Communications sent", "Decommission checklist complete"],
};

export const SPRINT_STATUSES = ["planning", "active", "review", "closed"] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

export const CR_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected", "implemented", "withdrawn"] as const;
export type CrStatus = (typeof CR_STATUSES)[number];
export const CR_TYPES = ["scope", "schedule", "budget", "requirement", "technical", "process"] as const;
export type CrType = (typeof CR_TYPES)[number];
export const CR_IMPACTS = ["low", "medium", "high", "critical"] as const;
export type CrImpact = (typeof CR_IMPACTS)[number];

/** Allowed change-request transitions (state machine). */
export const CR_TRANSITIONS: Record<CrStatus, CrStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "rejected", "withdrawn"],
  under_review: ["approved", "rejected", "submitted"],
  approved: ["implemented", "under_review"],
  rejected: ["submitted"],
  implemented: [],
  withdrawn: ["draft"],
};

export interface IssueLite {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  storyPoints: number | null;
  labels: string[];
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  capacityPoints: number;
  sequence: number;
  retro: { wentWell?: string; improve?: string; actions?: string };
  startedAt: string | null;
  closedAt: string | null;
}

export interface SprintItem {
  id: string;
  sprintId: string;
  issueId: string;
  storyPoints: number | null;
  committed: boolean;
  carriedFromSprintId: string | null;
}

export interface Snapshot {
  date: string;
  remaining: number;
  committed: number;
  done: number;
}

export interface ChangeRequest {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string | null;
  type: CrType;
  impact: CrImpact;
  impactAssessment: string | null;
  status: CrStatus;
  priority: string;
  requestedByType: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  ownerAgentId: string | null;
  ownerUserId: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  relatedIssueIds: string[];
  implementationIssueId: string | null;
  targetSprintId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrEvent {
  id: string;
  kind: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  actorType: string | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface Lifecycle {
  stage: Stage;
  gates: Record<string, string[]>; // stage -> completed gate labels
  vision: string | null;
  targetLaunch: string | null;
  sprintLengthDays: number;
  defaultCapacityPoints: number;
  history: { fromStage: string | null; toStage: string; note: string | null; actor: string | null; createdAt: string }[];
}

export interface ProjectOverview {
  project: { id: string; name: string; status: string; color: string | null; targetDate: string | null };
  lifecycle: Lifecycle;
  sprints: Sprint[];
  activeSprint: Sprint | null;
  items: SprintItem[];
  issues: IssueLite[];
  snapshots: Record<string, Snapshot[]>;
  changeRequests: ChangeRequest[];
  agents: { id: string; name: string; role: string; status: string }[];
  humans: { id: string; name: string; email?: string | null }[];
  velocity: { sprintId: string; name: string; committed: number; done: number }[];
  today: string;
}
