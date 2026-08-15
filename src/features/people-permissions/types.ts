export interface Person {
  id: string;
  name: string;
  email: string;
  title: string;
  dept: string;
  division: string;
  roles: string[];
  license: string;
  skills: Record<string, number>;
  langs: string[];
  station: string;
  state: "Active" | "Pending invite" | "Inactive";
  created: string;
  ext: string;
}

export interface Role {
  id: string;
  name: string;
  desc: string;
  base: boolean;
  perms: string[];
}

export interface Division {
  id: string;
  name: string;
  desc: string;
  home?: boolean;
}

export interface SimpleEntity {
  id: string;
  name: string;
  desc?: string;
}

export interface Group {
  id: string;
  name: string;
  type: "Official" | "Social";
  ext: string;
  ring: "Broadcast" | "Sequential" | "Rotary";
  members: string[];
  vm: boolean;
}

export interface DirectoryData {
  people: Person[];
  roles: Role[];
  divisions: Division[];
  groups: Group[];
  skills: SimpleEntity[];
  langs: SimpleEntity[];
  licenses: Record<string, number>;
}

export const PERMISSION_DOMAINS: Record<string, string[]> = {
  People: ["view", "edit", "delete", "invite"],
  Roles: ["view", "edit", "delete"],
  Queues: ["view", "edit", "delete"],
  Telephony: ["view", "edit"],
  Reporting: ["view", "export"],
  Billing: ["view", "edit"],
};
