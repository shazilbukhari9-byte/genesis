export interface RecordingPolicy {
  id: string;
  name: string;
  media: string[];
  queues: string[];
  retention: number;
  pct: number;
  active: boolean;
}

export interface Queue {
  id: string;
  name: string;
}
