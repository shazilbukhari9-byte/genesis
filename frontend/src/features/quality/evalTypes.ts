export interface EvalQuestion {
  id: string;
  text: string;
  weight: number;
  critical: boolean;
}

export interface EvalGroup {
  name: string;
  questions: EvalQuestion[];
}

export interface EvalForm {
  id: string;
  name: string;
  published: boolean;
  groups: EvalGroup[];
}

export type Answer = "yes" | "no" | "na";

export interface EvalRecord {
  id: string;
  formId: string | null;
  formName: string;
  interactionId: string | null;
  interactionLabel: string;
  agentName: string;
  answers: Record<string, Answer>;
  pct: number;
  criticalFail: boolean;
  createdAt: string;
}

export interface InteractionSummary {
  id: string;
  customerName: string;
  agentId: string | null;
  agentName: string;
  queueName: string;
  media: string;
  result: string;
  startedAt: string;
}
