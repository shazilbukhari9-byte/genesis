export interface PlanningGroup {
  id: string;
  name: string;
  queues: string[];
  skills: string[];
  langs: string[];
}

export interface ServiceGoal {
  id: string;
  name: string;
  sl: number;
  sls: number;
  asa: number;
  abn: number;
  pgs: string[];
}

export interface ForecastGroupData {
  vol: number;
  aht: number;
  days: Record<string, number>;
}

export interface Forecast {
  id: string;
  week: string;
  status: string;
  generatedAt: string;
  data: Record<string, ForecastGroupData>;
}

export interface QueueOption {
  id: string;
  name: string;
}
