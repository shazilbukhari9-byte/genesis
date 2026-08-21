import type { DirectoryData, Division, Group, Person, Role, SimpleEntity } from "./types";
import { apiFetch } from "../shared/backend";

// People (this file's `people` list only — Divisions/Groups below are still
// localStorage-backed, a separate follow-up) are backed by the real `users`
// table via the generic /api/people resource registered in
// backend/resources.py. roles is users.roles (integer[] of roles.id, cast
// to strings here to match Role.id elsewhere), skills is users.skills
// (jsonb {skillName: proficiency}), langs is users.langs (text[]).
interface BackendPerson {
  id: number;
  name: string;
  email: string | null;
  license_code: string | null;
  state: string;
  division: string | null;
  title: string | null;
  dept: string | null;
  station: string | null;
  ext: string | null;
  roles: number[] | null;
  skills: Record<string, number> | null;
  langs: string[] | null;
}

function fromBackendPerson(u: BackendPerson): Person {
  return {
    id: String(u.id),
    name: u.name,
    email: u.email ?? "",
    title: u.title ?? "",
    dept: u.dept ?? "",
    division: u.division ?? "",
    roles: (u.roles ?? []).map(String),
    license: u.license_code ?? "",
    skills: u.skills ?? {},
    langs: u.langs ?? [],
    station: u.station ?? "",
    state: (u.state as Person["state"]) || "Active",
    created: "",
    ext: u.ext ?? "",
  };
}

interface BackendDivision {
  code: string;
  name: string;
  description: string | null;
  is_home: boolean;
}

interface BackendSimpleEntity {
  id: number;
  kind: string;
  name: string;
  description: string | null;
}

interface BackendLicense {
  code: string;
  label: string;
  purchased: number;
  unit_price: number;
}

interface BackendRole {
  id: number;
  name: string;
  description: string | null;
  base: boolean;
  perms: string[] | null;
}

interface BackendGroup {
  id: number;
  name: string;
  type: string;
  ext: string | null;
  ring: string;
  members: string[] | null;
  vm: boolean;
}

function fromBackendDivision(d: BackendDivision): Division {
  return { id: d.code, name: d.name, desc: d.description ?? "", home: d.is_home };
}

function fromBackendSimpleEntity(e: BackendSimpleEntity): SimpleEntity {
  return { id: String(e.id), name: e.name, desc: e.description ?? "" };
}

function fromBackendRole(r: BackendRole): Role {
  return { id: String(r.id), name: r.name, desc: r.description ?? "", base: r.base, perms: r.perms ?? [] };
}

function fromBackendGroup(g: BackendGroup): Group {
  return {
    id: String(g.id),
    name: g.name,
    type: (g.type as Group["type"]) || "Official",
    ext: g.ext ?? "",
    ring: (g.ring as Group["ring"]) || "Sequential",
    members: g.members ?? [],
    vm: g.vm,
  };
}

function toBackendPerson(person: Partial<Person>): Record<string, unknown> {
  return {
    name: person.name,
    email: person.email,
    license_code: person.license,
    state: person.state,
    division: person.division,
    title: person.title,
    dept: person.dept,
    station: person.station,
    ext: person.ext,
    ...(person.roles ? { roles: person.roles.map(Number) } : {}),
    ...(person.skills ? { skills: person.skills } : {}),
    ...(person.langs ? { langs: person.langs } : {}),
  };
}

// -----------------------------------------------------------------------------
// Shared data layer for every People & Permissions page (People, Roles,
// Divisions, Groups, ACD Skills, ACD Languages, Licence Assignment).
//
// All of it is localStorage-backed for now, behind the small set of async
// functions exported below. Swapping in a real backend later means rewriting
// the bodies of these functions (and splitting them across real endpoints if
// needed) — the pages themselves only ever call these functions.
// -----------------------------------------------------------------------------

const STORAGE_KEY = "mcm_people_directory_v2";
const SIMULATED_LATENCY_MS = 200;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS));
}

function logAudit(action: string, detail: string): void {
  const win = window as unknown as {
    DB?: { audit?: { t: string; who: string; act: string; obj?: string }[] };
    APP?: { user?: { name?: string } };
  };
  if (!win.DB) return;
  if (!win.DB.audit) win.DB.audit = [];
  const now = new Date();
  const t =
    now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " " +
    now.toTimeString().slice(0, 5);
  win.DB.audit.unshift({ t, who: win.APP?.user?.name ?? "Admin", act: action, obj: detail });
}

function defaultDirectory(): DirectoryData {
  const divisions: Division[] = [
    { id: "d_home", name: "HQ (London)", desc: "Default division for new users", home: true },
    { id: "d_mumbai", name: "Mumbai Hub", desc: "APAC delivery centre" },
    { id: "d_sales", name: "Sales", desc: "Revenue & new business" },
  ];

  const roles: Role[] = [
    { id: "r_admin", name: "Admin", desc: "Full platform access", base: true, perms: ["People:view", "People:edit", "People:delete", "Roles:view", "Roles:edit", "Billing:view", "Billing:edit"] },
    { id: "r_supervisor", name: "Supervisor", desc: "Manages a team of agents", base: true, perms: ["People:view", "Queues:view", "Queues:edit", "Reporting:view"] },
    { id: "r_agent", name: "Agent", desc: "Handles interactions", base: true, perms: ["Queues:view"] },
    { id: "r_qa", name: "QA Analyst", desc: "Reviews interaction quality", base: false, perms: ["Reporting:view", "Reporting:export"] },
  ];

  const skills: SimpleEntity[] = [
    { id: "sk_billing", name: "Billing", desc: "Billing & payments" },
    { id: "sk_tech", name: "Technical Support", desc: "L1/L2 troubleshooting" },
    { id: "sk_sales", name: "Sales", desc: "New business & upsell" },
  ];

  const langs: SimpleEntity[] = [
    { id: "lg_en", name: "English" },
    { id: "lg_hi", name: "Hindi" },
    { id: "lg_es", name: "Spanish" },
  ];

  const people: Person[] = [
    {
      id: "u_fkhan",
      name: "Faisal Khan",
      email: "fkhan@mcmgroup.com",
      title: "Head of CX",
      dept: "Operations",
      division: "d_home",
      roles: ["r_admin"],
      license: "CX 3",
      skills: { Billing: 5 },
      langs: ["English"],
      station: "WebRTC softphone",
      state: "Active",
      created: "04 Jan 2026",
      ext: "1001",
    },
    {
      id: "u_spetrova",
      name: "Sofia Petrova",
      email: "spetrova@mcmgroup.com",
      title: "Advisor",
      dept: "Support",
      division: "d_home",
      roles: ["r_agent"],
      license: "CX 2",
      skills: { "Technical Support": 4 },
      langs: ["English"],
      station: "WebRTC softphone",
      state: "Active",
      created: "12 Jan 2026",
      ext: "1002",
    },
    {
      id: "u_rpatel",
      name: "Rajan Patel",
      email: "rpatel@mcmgroup.com",
      title: "Collections Agent",
      dept: "Finance",
      division: "d_mumbai",
      roles: ["r_agent"],
      license: "CX 2",
      skills: { Billing: 3 },
      langs: ["English", "Hindi"],
      station: "Remote number",
      state: "Active",
      created: "20 Jan 2026",
      ext: "2001",
    },
    {
      id: "u_mrossi",
      name: "Marco Rossi",
      email: "mrossi@mcmgroup.com",
      title: "Team Leader",
      dept: "Support",
      division: "d_home",
      roles: ["r_supervisor"],
      license: "CX 3",
      skills: { "Technical Support": 5, Billing: 2 },
      langs: ["English"],
      station: "WebRTC softphone",
      state: "Pending invite",
      created: "02 Feb 2026",
      ext: "1003",
    },
  ];

  const groups: Group[] = [
    { id: "g_support", name: "Support Desk", type: "Official", ext: "7100", ring: "Broadcast", members: ["u_spetrova", "u_mrossi"], vm: true },
    { id: "g_social", name: "Coffee Chat", type: "Social", ext: "", ring: "Sequential", members: ["u_fkhan", "u_spetrova"], vm: false },
  ];

  return {
    people,
    roles,
    divisions,
    groups,
    skills,
    langs,
    licenses: { "CX 1": 40, "CX 2": 60, "CX 3": 25, "CX 4": 10, Communicate: 50 },
  };
}

function readStore(): DirectoryData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as DirectoryData;
    } catch {
      // fall through to defaults on corrupt data
    }
  }
  const data = defaultDirectory();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function writeStore(data: DirectoryData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function fetchDirectory(): Promise<DirectoryData> {
  const data = readStore();
  try {
    const users = await apiFetch<BackendPerson[]>("/api/people?limit=500");
    data.people = users.map(fromBackendPerson);
  } catch {
    // offline / not logged in yet — fall back to whatever was last cached locally
  }
  try {
    const divisions = await apiFetch<BackendDivision[]>("/api/divisions");
    data.divisions = divisions.map(fromBackendDivision);
  } catch {
    // keep local divisions
  }
  try {
    const licenses = await apiFetch<BackendLicense[]>("/api/licenses");
    data.licenses = Object.fromEntries(licenses.map((l) => [l.code, l.purchased]));
  } catch {
    // keep local licenses
  }
  try {
    const [skills, langs] = await Promise.all([
      apiFetch<BackendSimpleEntity[]>("/api/simple-entities?kind=skill"),
      apiFetch<BackendSimpleEntity[]>("/api/simple-entities?kind=lang"),
    ]);
    data.skills = skills.map(fromBackendSimpleEntity);
    data.langs = langs.map(fromBackendSimpleEntity);
  } catch {
    // keep local skills/langs
  }
  try {
    const roles = await apiFetch<BackendRole[]>("/api/roles?limit=500");
    data.roles = roles.map(fromBackendRole);
  } catch {
    // keep local roles
  }
  try {
    const groups = await apiFetch<BackendGroup[]>("/api/groups?limit=500");
    data.groups = groups.map(fromBackendGroup);
  } catch {
    // keep local groups
  }
  return data;
}

export async function upsertPerson(person: Omit<Person, "id" | "created"> & { id?: string }): Promise<DirectoryData> {
  const payload = toBackendPerson(person);
  if (person.id) {
    await apiFetch(`/api/people/${person.id}`, { method: "PUT", body: JSON.stringify(payload) });
    logAudit("Edit person", person.name);
  } else {
    await apiFetch("/api/people", { method: "POST", body: JSON.stringify({ ...payload, state: person.state || "Active" }) });
    logAudit("Create person", person.name);
  }
  return fetchDirectory();
}

export async function deletePerson(id: string): Promise<DirectoryData> {
  await apiFetch(`/api/people/${id}`, { method: "DELETE" });
  logAudit("Delete person", `person #${id}`);
  return fetchDirectory();
}

export async function bulkUpdatePeople(ids: string[], action: "activate" | "deactivate" | "delete"): Promise<DirectoryData> {
  if (action === "delete") {
    await Promise.all(ids.map((id) => apiFetch(`/api/people/${id}`, { method: "DELETE" }).catch(() => undefined)));
  } else {
    const state = action === "activate" ? "Active" : "Inactive";
    await Promise.all(
      ids.map((id) => apiFetch(`/api/people/${id}`, { method: "PUT", body: JSON.stringify({ state }) }).catch(() => undefined)),
    );
  }
  logAudit("Bulk " + action, ids.length + " people");
  return fetchDirectory();
}

export async function upsertRole(role: Omit<Role, "id" | "base"> & { id?: string }): Promise<DirectoryData> {
  const payload = { name: role.name, description: role.desc, perms: role.perms };
  if (role.id) {
    await apiFetch(`/api/roles/${role.id}`, { method: "PUT", body: JSON.stringify(payload) });
    logAudit("Edit role", role.name);
  } else {
    await apiFetch("/api/roles", { method: "POST", body: JSON.stringify({ ...payload, base: false }) });
    logAudit("Create role", role.name);
  }
  return fetchDirectory();
}

export async function deleteRole(id: string): Promise<DirectoryData> {
  await apiFetch(`/api/roles/${id}`, { method: "DELETE" });
  logAudit("Delete role", `role #${id}`);
  return fetchDirectory();
}

export async function upsertDivision(division: Omit<Division, "id" | "home"> & { id?: string }): Promise<DirectoryData> {
  if (division.id) {
    await apiFetch(`/api/divisions/${division.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: division.name, description: division.desc }),
    });
    logAudit("Edit division", division.name);
  } else {
    await apiFetch("/api/divisions", {
      method: "POST",
      body: JSON.stringify({ name: division.name, description: division.desc }),
    });
    logAudit("Create division", division.name);
  }
  return fetchDirectory();
}

export async function deleteDivision(id: string): Promise<DirectoryData> {
  await apiFetch(`/api/divisions/${id}`, { method: "DELETE" });
  logAudit("Delete division", `division ${id}`);
  return fetchDirectory();
}

export async function upsertGroup(group: Omit<Group, "id"> & { id?: string }): Promise<DirectoryData> {
  const payload = { name: group.name, type: group.type, ext: group.ext, ring: group.ring, members: group.members, vm: group.vm };
  if (group.id) {
    await apiFetch(`/api/groups/${group.id}`, { method: "PUT", body: JSON.stringify(payload) });
    logAudit("Edit group", group.name);
  } else {
    await apiFetch("/api/groups", { method: "POST", body: JSON.stringify(payload) });
    logAudit("Create group", group.name);
  }
  return fetchDirectory();
}

export async function deleteGroup(id: string): Promise<DirectoryData> {
  await apiFetch(`/api/groups/${id}`, { method: "DELETE" });
  logAudit("Delete group", `group #${id}`);
  return fetchDirectory();
}

export type SimpleEntityKind = "skills" | "langs";

// roles/skills/langs aren't columns on `users` yet (see the People-page
// connection notes above), so unlike the old localStorage version this no
// longer tries to rename references to a skill/language on people — there's
// nothing real to rename until those get their own backing.
export async function upsertSimpleEntity(kind: SimpleEntityKind, entity: Omit<SimpleEntity, "id"> & { id?: string }): Promise<DirectoryData> {
  const backendKind = kind === "skills" ? "skill" : "lang";
  const label = kind === "skills" ? "skill" : "language";
  if (entity.id) {
    await apiFetch(`/api/simple-entities/${entity.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: entity.name, description: entity.desc }),
    });
    logAudit("Edit " + label, entity.name);
  } else {
    await apiFetch("/api/simple-entities", {
      method: "POST",
      body: JSON.stringify({ kind: backendKind, name: entity.name, description: entity.desc }),
    });
    logAudit("Create " + label, entity.name);
  }
  return fetchDirectory();
}

export async function deleteSimpleEntity(kind: SimpleEntityKind, id: string): Promise<DirectoryData> {
  const label = kind === "skills" ? "skill" : "language";
  await apiFetch(`/api/simple-entities/${id}`, { method: "DELETE" });
  logAudit("Delete " + label, `#${id}`);
  return fetchDirectory();
}

export async function assignLicence(personId: string, license: string): Promise<DirectoryData> {
  await apiFetch(`/api/people/${personId}`, { method: "PUT", body: JSON.stringify({ license_code: license }) });
  logAudit("Change licence", `person #${personId} → ${license}`);
  return fetchDirectory();
}

// CSV columns: name,email,title,department,division,license
// Skills aren't backend-persisted yet, so the skills column (if present) is
// parsed but discarded — a follow-up once ACD Skills has its own backend.
export async function bulkImportPeopleCsv(csvText: string): Promise<{ data: DirectoryData; imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;
  const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
  const startIdx = lines[0]?.toLowerCase().startsWith("name,") ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = (lines[i] ?? "").split(",").map((c) => c.trim());
    const [name, email, title = "", dept = "", divisionName = "", license = "CX 1"] = cols;
    if (!name || !email) {
      errors.push(`Row ${i + 1}: name and email are required`);
      continue;
    }
    try {
      await apiFetch("/api/people", {
        method: "POST",
        body: JSON.stringify({ name, email, title, dept, division: divisionName, license_code: license, state: "Active" }),
      });
      imported++;
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : "import failed"}`);
    }
  }

  if (imported > 0) logAudit("CSV import", `${imported} people`);
  const data = await fetchDirectory();
  return { data, imported, errors };
}

export async function exportAllDirectoryData(): Promise<DirectoryData> {
  const data = readStore();
  logAudit("Export", "all directory data (JSON)");
  return delay(data);
}

export async function importAllDirectoryData(json: string): Promise<DirectoryData> {
  const parsed = JSON.parse(json) as DirectoryData;
  writeStore(parsed);
  logAudit("Import", "directory data (JSON)");
  return delay(parsed);
}

export async function resetDemoData(): Promise<DirectoryData> {
  const data = defaultDirectory();
  writeStore(data);
  logAudit("Reset demo data", "People & Permissions");
  return delay(data);
}
