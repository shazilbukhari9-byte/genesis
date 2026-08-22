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
  // Beyond the UI prototype (which only ever toggles a language on/off):
  // a 1-5 rating per spoken language, same scale as skill proficiency, so
  // language-aware routing can prefer the strongest speaker among eligible
  // agents rather than picking any agent who merely has the language.
  // langs stays the membership source of truth; this is kept in sync with
  // it whenever a language is checked/unchecked.
  langProficiency: Record<string, number>;
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
  directory: ["user:add", "user:edit", "user:view", "user:delete", "group:add", "group:edit", "location:add", "location:edit"],
  authorization: ["role:add", "role:edit", "role:view", "role:delete", "division:add", "division:edit", "division:delete", "grant:add"],
  routing: ["queue:add", "queue:edit", "queue:view", "skill:add", "skill:edit", "wrapupCode:add", "email:manage", "message:manage"],
  conversation: ["call:accept", "call:record", "call:monitor", "call:coach", "call:barge", "callback:add", "email:accept", "message:accept"],
  analytics: ["view:view", "dashboard:add", "dashboard:edit", "alert:add", "alert:edit", "export:add"],
  quality: ["evaluation:add", "evaluation:edit", "calibration:add", "recording:view", "recordingPolicy:edit"],
  telephony: ["plugin:all", "trunk:edit", "site:edit", "edge:edit", "phone:add", "phone:assign", "did:edit", "extension:edit"],
  architect: ["flow:add", "flow:edit", "flow:publish", "flow:delete", "prompt:add", "datatable:edit"],
  outbound: ["campaign:add", "campaign:edit", "contactList:add", "dnc:edit", "ruleSet:edit"],
  wem: ["schedule:add", "schedule:edit", "forecast:add", "adherence:view", "gamification:edit"],
};
