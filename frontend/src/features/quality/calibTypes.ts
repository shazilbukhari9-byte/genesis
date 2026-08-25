export interface CalibrationEvaluator {
  name: string;
  score: number | null;
}

export type CalibStatus = "Scheduled" | "In Progress" | "Review Variance" | "Completed";

export interface Calibration {
  id: string;
  name: string;
  formRef: string;
  interactionRef: string;
  division: string;
  status: CalibStatus;
  evaluators: CalibrationEvaluator[];
  notes: string;
  dueDate: string;
  hideScoresUntilComplete: boolean;
  includeAgentSelfAssessment: boolean;
  notifyEvaluatorsByEmail: boolean;
}

export interface PersonOption {
  id: string;
  name: string;
}
