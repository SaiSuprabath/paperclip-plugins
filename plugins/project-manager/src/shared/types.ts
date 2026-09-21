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
  initials: string | null;
  groupName: string | null;
  maxUnitsPct: number;
  overtimeRate: number | null;
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
  /** Effective parent in the outline (plugin-side parent, falling back to the Paperclip parent issue). */
  parentIssueId: string | null;
  outlineLevel: number;
  isSummary: boolean;
  collapsed: boolean;
  plannedCostOverride: number | null;
  actualCostManual: number | null;
  actualHours: number | null;
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
  plan: PlanSettings;
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

export interface PlanSettings {
  startDate: string;
  statusDate: string | null;
  baselineSavedAt: string | null;
  budgetAmount: number | null;
  currency: string;
  sponsor: string | null;
  pmName: string | null;
  pmEmail: string | null;
  ragOverride: string | null;
  autoNudge: boolean;
  reportRecipients: string | null;
}

export type Rag = "green" | "amber" | "red";

export interface EvmMetrics {
  statusDate: string;
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  sv: number;
  cv: number;
  spi: number | null;
  cpi: number | null;
  eac: number;
  etc: number;
  vac: number;
  tcpi: number | null;
  pctComplete: number;
  pctPlanned: number;
  pctSpent: number;
  forecastFinish: string;
  plannedFinish: string;
  rag: Rag;
  ragReasons: string[];
}

export interface CurvePoint { date: string; pv: number; ev: number | null; ac: number | null; forecast?: boolean }

export interface TaskCostRow {
  issueId: string;
  identifier: string | null;
  title: string;
  outlineLevel: number;
  isSummary: boolean;
  plannedCost: number;
  plannedHours: number;
  actualCost: number;
  agentCost: number;
  actualHours: number;
  earnedValue: number;
  percentComplete: number;
  resources: string;
  overridden: boolean;
}

export interface ResourceCostRow { resourceId: string; name: string; kind: ResourceKind; plannedHours: number; plannedCost: number; taskCount: number }

export interface EvmPayload {
  metrics: EvmMetrics;
  curve: CurvePoint[];
  snapshots: { date: string; pv: number; ev: number; ac: number; bac: number }[];
  tasks: TaskCostRow[];
  resources: ResourceCostRow[];
  settings: PlanSettings;
  currency: string;
}

export interface Stakeholder { id: string; name: string; role: string | null; organization: string | null; email: string | null; userId: string | null; agentId: string | null; power: string; interest: string; channel: string | null; frequency: string | null; notes: string | null }
export interface CommItem { id: string; item: string; audience: string | null; channel: string | null; frequency: string | null; owner: string | null; nextDue: string | null; notes: string | null }
export interface RaidItem { id: string; kind: string; title: string; description: string | null; probability: number | null; impact: number | null; score: number | null; response: string | null; owner: string | null; status: string; dueDate: string | null; issueId: string | null; createdBy: string | null; createdAt: string; closedAt: string | null }
export interface StatusReport { id: string; periodStart: string; periodEnd: string; rag: Rag; contentMd: string; metrics: Partial<EvmMetrics>; sentTo: string[]; createdBy: string | null; createdAt: string }
export interface NudgeLog { id: string; issueId: string | null; targetKind: string; targetName: string | null; channel: string; message: string | null; actor: string | null; createdAt: string }
export interface AttentionItem { issueId: string; identifier: string | null; title: string; kind: "overdue" | "due_soon" | "stalled" | "unassigned" | "blocked"; finish: string; daysLate: number; ownerKind: "agent" | "human" | "none"; ownerId: string | null; ownerName: string | null; ownerEmail: string | null; critical: boolean; percentComplete: number; status: string }

export interface CommsPayload {
  stakeholders: Stakeholder[];
  commPlan: CommItem[];
  raid: RaidItem[];
  reports: StatusReport[];
  nudges: NudgeLog[];
  attention: AttentionItem[];
  email: { provider: "mailto" | "resend"; configured: boolean; from: string | null };
  settings: PlanSettings;
  metrics: EvmMetrics;
  milestones: { issueId: string; identifier: string | null; title: string; date: string; done: boolean }[];
}
