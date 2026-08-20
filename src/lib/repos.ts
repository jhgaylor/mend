/**
 * Which mender works on which repo — remembered per Fountain URL, in this
 * browser. Only choices live here (repo → agent id, and which repo is open);
 * every audit and patch is derived from the mender's conversation.
 */

const KEY = "mend.repos";

interface Store {
  [baseUrl: string]: { selected?: string; repos: Record<string, string> };
}

function load(): Store {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function save(store: Store): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

/** repo key (`host/owner/name`) → agent id, for one Fountain. */
export function loadRepos(baseUrl: string): Record<string, string> {
  const entry = load()[baseUrl];
  return entry && typeof entry.repos === "object" && entry.repos !== null ? { ...entry.repos } : {};
}

export function saveRepo(baseUrl: string, key: string, agentId: string): void {
  const store = load();
  const entry = store[baseUrl] ?? { repos: {} };
  entry.repos[key] = agentId;
  store[baseUrl] = entry;
  save(store);
}

/** Drop entries whose agent is gone from the team (the roster is the truth). */
export function reconcileRepos(baseUrl: string, live: Record<string, string>): void {
  const store = load();
  const entry = store[baseUrl] ?? { repos: {} };
  entry.repos = { ...live };
  if (entry.selected && !(entry.selected in entry.repos)) delete entry.selected;
  store[baseUrl] = entry;
  save(store);
}

export function loadSelected(baseUrl: string): string | null {
  const entry = load()[baseUrl];
  return entry && typeof entry.selected === "string" ? entry.selected : null;
}

export function saveSelected(baseUrl: string, key: string | null): void {
  const store = load();
  const entry = store[baseUrl] ?? { repos: {} };
  if (key) entry.selected = key;
  else delete entry.selected;
  store[baseUrl] = entry;
  save(store);
}
