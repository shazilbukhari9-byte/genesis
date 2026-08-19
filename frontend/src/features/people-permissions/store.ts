import type { DirectoryData, Division, Group, Person, Role, SimpleEntity } from "./types";
import { apiFetch } from "../shared/backend";

// People (this file's `people` list only — Roles/Divisions/Groups/Skills/
// Languages below are still localStorage-backed, a separate follow-up) are
// backed by the real `users` table via the generic /api/people resource
// registered in backend/resources.py. roles/skills/langs aren't columns on
// that table yet, so they come back empty from the backend for now.
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
}

function fromBackendPerson(u: BackendPerson): Person {
  return {
    id: String(u.id),
    name: u.name,
    email: u.email ?? "",
    title: u.title ?? "",
    dept: u.dept ?? "",
    division: u.division ?? "",
    roles: [],
    license: u.license_code ?? "",
    skills: {},
    langs: [],
    station: u.station ?? "",
    state: (u.state as Person["state"]) || "Active",
    created: "",
    ext: u.ext ?? "",
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

function uid(): string {
  return "id" + Math.random().toString(36).slice(2, 10);
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
  const data = readStore();
  if (role.id) {
    const idx = data.roles.findIndex((r) => r.id === role.id);
    if (idx >= 0) {
      const existing = data.roles[idx];
      if (existing) {
        data.roles[idx] = { ...existing, ...role, id: role.id, base: existing.base };
        logAudit("Edit role", role.name);
      }
    }
  } else {
    data.roles.push({ ...role, id: uid(), base: false });
    logAudit("Create role", role.name);
  }
  writeStore(data);
  return delay(data);
}

export async function deleteRole(id: string): Promise<DirectoryData> {
  const data = readStore();
  const role = data.roles.find((r) => r.id === id);
  data.roles = data.roles.filter((r) => r.id !== id);
  data.people = data.people.map((p) => ({ ...p, roles: p.roles.filter((r) => r !== id) }));
  if (role) logAudit("Delete role", role.name);
  writeStore(data);
  return delay(data);
}

export async function upsertDivision(division: Omit<Division, "id" | "home"> & { id?: string }): Promise<DirectoryData> {
  const data = readStore();
  if (division.id) {
    const idx = data.divisions.findIndex((d) => d.id === division.id);
    if (idx >= 0) {
      data.divisions[idx] = { ...data.divisions[idx], ...division, id: division.id };
      logAudit("Edit division", division.name);
    }
  } else {
    data.divisions.push({ ...division, id: uid() });
    logAudit("Create division", division.name);
  }
  writeStore(data);
  return delay(data);
}

export async function deleteDivision(id: string): Promise<DirectoryData> {
  const data = readStore();
  const division = data.divisions.find((d) => d.id === id);
  const home = data.divisions.find((d) => d.home)?.id ?? "d_home";
  data.divisions = data.divisions.filter((d) => d.id !== id);
  data.people = data.people.map((p) => (p.division === id ? { ...p, division: home } : p));
  if (division) logAudit("Delete division", division.name);
  writeStore(data);
  return delay(data);
}

export async function upsertGroup(group: Omit<Group, "id"> & { id?: string }): Promise<DirectoryData> {
  const data = readStore();
  if (group.id) {
    const idx = data.groups.findIndex((g) => g.id === group.id);
    if (idx >= 0) {
      data.groups[idx] = { ...data.groups[idx], ...group, id: group.id };
      logAudit("Edit group", group.name);
    }
  } else {
    data.groups.push({ ...group, id: uid() });
    logAudit("Create group", group.name);
  }
  writeStore(data);
  return delay(data);
}

export async function deleteGroup(id: string): Promise<DirectoryData> {
  const data = readStore();
  const group = data.groups.find((g) => g.id === id);
  data.groups = data.groups.filter((g) => g.id !== id);
  if (group) logAudit("Delete group", group.name);
  writeStore(data);
  return delay(data);
}

export type SimpleEntityKind = "skills" | "langs";

export async function upsertSimpleEntity(kind: SimpleEntityKind, entity: Omit<SimpleEntity, "id"> & { id?: string }): Promise<DirectoryData> {
  const data = readStore();
  const list = data[kind];
  if (entity.id) {
    const idx = list.findIndex((e) => e.id === entity.id);
    const existing = idx >= 0 ? list[idx] : undefined;
    if (idx >= 0 && existing) {
      const oldName = existing.name;
      list[idx] = { ...existing, ...entity, id: entity.id };
      if (kind === "skills" && oldName !== entity.name) {
        data.people = data.people.map((p) => {
          const level = p.skills[oldName];
          if (level === undefined) return p;
          const skills = { ...p.skills };
          skills[entity.name] = level;
          delete skills[oldName];
          return { ...p, skills };
        });
      }
      if (kind === "langs" && oldName !== entity.name) {
        data.people = data.people.map((p) =>
          p.langs.includes(oldName) ? { ...p, langs: p.langs.map((l) => (l === oldName ? entity.name : l)) } : p,
        );
      }
      logAudit("Edit " + (kind === "skills" ? "skill" : "language"), entity.name);
    }
  } else {
    list.push({ ...entity, id: uid() });
    logAudit("Create " + (kind === "skills" ? "skill" : "language"), entity.name);
  }
  writeStore(data);
  return delay(data);
}

export async function deleteSimpleEntity(kind: SimpleEntityKind, id: string): Promise<DirectoryData> {
  const data = readStore();
  const entity = data[kind].find((e) => e.id === id);
  data[kind] = data[kind].filter((e) => e.id !== id);
  if (entity) {
    if (kind === "skills") {
      data.people = data.people.map((p) => {
        if (!(entity.name in p.skills)) return p;
        const skills = { ...p.skills };
        delete skills[entity.name];
        return { ...p, skills };
      });
    } else {
      data.people = data.people.map((p) => ({ ...p, langs: p.langs.filter((l) => l !== entity.name) }));
    }
    logAudit("Delete " + (kind === "skills" ? "skill" : "language"), entity.name);
  }
  writeStore(data);
  return delay(data);
}

export async function assignLicence(personId: string, license: string): Promise<DirectoryData> {
  await apiFetch(`/api/people/${personId}`, { method: "PUT", body: JSON.stringify({ license_code: license }) });
  logAudit("Change licence", `person #${personId} → ${license}`);
  return fetchDirectory();
}

// CSV columns: name,email,title,department,division,license,skills
// Skills use Skill:proficiency separated by ';', e.g. "Billing:5;Sales:3".
// Name and email are mandatory. Unknown divisions fall back to Home.
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
