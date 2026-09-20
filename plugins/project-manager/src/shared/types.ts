// Shared DTOs between the worker and the UI bundle.
export type LinkType = "FS" | "SS" | "FF" | "SF";
export type ConstraintType = "asap" | "snet" | "mso";
export type ResourceKind = "human" | "agent";

export interface CalendarDef {
  /** JS weekday numbers that are working days (0 = Sunday). */
  workingDays: number[];
  /** ISO dates (YYYY-MM-DD) that are non-working. */
  holidays: string[];
  hoursPerDay: number;
}

export interface TaskLink {
  id: string;
  predecessorIssueId: string;
  successorIssueId: string;
  type: LinkType;
  lagDays: number;
}

export interface Resource {
  id: string;
  companyId: string;
  kind: ResourceKind;
  name: string;
  email: string | null;
  agentId: string | null;
  userId: string | null;
  role: string | null;
  capacityHoursPerDay: number;
  costPerHour: number | null;
  color: string | null;
  active: boolean;
}

export interface Assignment {
  id: string;
  issueId: string;
  resourceId: string;
  unitsPct: number;
}

export interface PlanTask {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  durationDays: number;
  effortHours: number | null;
  startDate: string | null;
  constraintType: ConstraintType;
  percentComplete: number;
  isMilestone: boolean;
  sortOrder: number;
  levelingDelayDays: number;
  notes: string | null;
  baselineStart: string | null;
  baselineFinish: string | null;
  // Computed by the CPM engine
  start: string;
  finish: string;
  lateStart: string;
  lateFinish: string;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
  predecessors: { issueId: string; type: LinkType; lagDays: number }[];
  successors: string[];
}

export interface PlanSummary {
  projectStart: string;
  projectFinish: string;
  durationDays: number;
  taskCount: number;
  criticalCount: number;
  completedCount: number;
  overdueCount: number;
  slippageDays: number | null; // vs baseline finish (positive = late)
  baselineFinish: string | null;
  percentComplete: number;
}

export interface PersonRef {
  id: string;
  name: string;
  email?: string | null;
}

export interface AgentRef {
  id: string;
  name: string;
  role: string;
  status: string;
}

export interface PlanPayload {
  project: { id: string; name: string; status: string; targetDate: string | null; color: string | null };
  plan: { startDate: string; statusDate: string | null; baselineSavedAt: string | null };
  calendar: CalendarDef;
  tasks: PlanTask[];
  links: TaskLink[];
  resources: Resource[];
  assignments: Assignment[];
  agents: AgentRef[];
  humans: PersonRef[];
  summary: PlanSummary;
  cycles: string[][];
  today: string;
}

export interface PortfolioRow {
  projectId: string;
  name: string;
  status: string;
  color: string | null;
  summary: PlanSummary | null;
}
