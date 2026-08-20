/**
 * The Fountain API, as much of it as Mend needs. Every call carries the
 * bearer key; every error is an `ApiError` with the server's `error` string
 * when there was one. Ported (slimmed) from jhgaylor/repo-sage / dns-desk.
 */
import type { Agent, Catalog, Environment, LogEvent, Me, SecretKey, Teammate, Turn, Vault } from "./types";
import { readSse, type SseMessage } from "../lib/sse";
import type { Settings } from "../lib/settings";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
    public retryAfter: number | null = null,
    public body: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

export class FountainClient {
  constructor(private settings: Settings) {}

  get baseUrl(): string {
    return this.settings.baseUrl;
  }

  me(): Promise<Me> {
    return this.json<Me>("GET", "/api/auth/me");
  }

  // ── the menders: teammates, one per repo ──────────────────────────────────

  async listTeam(): Promise<Teammate[]> {
    return (await this.json<{ data: Teammate[] }>("GET", "/api/team")).data;
  }

  /** `vault_id` can only be set here — Fountain has no way to attach one later. */
  async addTeammate(input: { agent_id: string; name?: string; environment_id?: string; vault_id?: string }): Promise<Teammate> {
    return (await this.json<{ data: Teammate }>("POST", "/api/team", input)).data;
  }

  /** Terminates the mender's conversation and takes it off the team. */
  removeTeammate(agentId: string): Promise<void> {
    return this.json<void>("DELETE", `/api/team/${agentId}`);
  }

  sendMessage(agentId: string, prompt: string): Promise<{ status: string; conversation_id: string }> {
    return this.json("POST", `/api/team/${agentId}/messages`, { prompt });
  }

  // ── the conversation a mender runs on ─────────────────────────────────────

  async listTurns(conversationId: string): Promise<Turn[]> {
    return (await this.json<{ data: Turn[] }>("GET", `/api/conversations/${conversationId}/turns`)).data;
  }

  /** Every event of the conversation on the given streams, oldest first, paging until drained. */
  async listAllEvents(conversationId: string, streams: string[]): Promise<LogEvent[]> {
    const out: LogEvent[] = [];
    let after: number | null = null;
    for (;;) {
      const qs = new URLSearchParams({ limit: "1000", streams: streams.join(",") });
      if (after !== null) qs.set("after", String(after));
      const page: { data: LogEvent[]; meta: { has_more: boolean; next_cursor: number | null } } =
        await this.json("GET", `/api/conversations/${conversationId}/events?${qs}`);
      out.push(...page.data);
      if (!page.meta.has_more || page.meta.next_cursor === null) break;
      after = page.meta.next_cursor;
    }
    return out;
  }

  markRead(conversationId: string): Promise<void> {
    return this.json<void>("POST", `/api/conversations/${conversationId}/read`);
  }

  // ── set-up: the toolkit environment and a mender agent ────────────────────

  async listEnvironments(): Promise<Environment[]> {
    return (await this.json<{ data: Environment[] }>("GET", "/api/environments")).data;
  }

  createEnvironment(input: {
    name: string;
    description?: string;
    networking_type?: "unrestricted" | "limited";
    packages?: Record<string, string[]>;
    setup_script?: string;
  }): Promise<Environment> {
    return this.json<{ data: Environment }>("POST", "/api/environments", input).then((r) => r.data);
  }

  // ── vaults: a per-repo credential, attached to one conversation ───────────

  async listVaults(): Promise<Vault[]> {
    return (await this.json<{ data: Vault[] }>("GET", "/api/vaults")).data;
  }

  async createVault(input: { name: string; description?: string }): Promise<Vault> {
    return (await this.json<{ data: Vault }>("POST", "/api/vaults", input)).data;
  }

  /** Keys and timestamps only — the API never returns a secret's value. */
  async listVaultSecretKeys(vaultId: string): Promise<SecretKey[]> {
    return (await this.json<{ data: SecretKey[] }>("GET", `/api/vaults/${vaultId}/secrets`)).data;
  }

  putVaultSecret(vaultId: string, key: string, value: string): Promise<unknown> {
    return this.json("POST", `/api/vaults/${vaultId}/secrets`, { key, value });
  }

  async listAgents(search?: string): Promise<Agent[]> {
    const qs = search ? `?${new URLSearchParams({ search })}` : "";
    return (await this.json<{ data: Agent[] }>("GET", `/api/agents${qs}`)).data;
  }

  createAgent(input: {
    name: string;
    model: string;
    runtime: string;
    description?: string;
    system?: string;
    environment_id?: string;
  }): Promise<Agent> {
    return this.json<{ data: Agent }>("POST", "/api/agents", input).then((r) => r.data);
  }

  /** Update an existing agent — used to bring an old mender's system prompt up to date. */
  updateAgent(id: string, input: { system?: string; description?: string }): Promise<Agent> {
    return this.json<{ data: Agent }>("PUT", `/api/agents/${id}`, input).then((r) => r.data);
  }

  getCatalog(): Promise<Catalog> {
    return this.json<{ data: Catalog }>("GET", "/api/catalog").then((r) => r.data);
  }

  // ── stream ────────────────────────────────────────────────────────────────

  /**
   * The whole team's events on one connection. Resolves when the server
   * closes (idle timeout, deploy); the caller reconnects with the last id.
   */
  streamTeam(opts: {
    lastEventId: string | null;
    streams: string[];
    signal: AbortSignal;
    onMessage: (msg: SseMessage) => void;
    onOpen?: () => void;
    onClose: (err?: unknown) => void;
  }): Promise<void> {
    const qs = new URLSearchParams({ streams: opts.streams.join(",") });
    return readSse(`${this.baseUrl}/api/team/stream?${qs}`, {
      headers: { authorization: `Bearer ${this.settings.apiKey}` },
      lastEventId: opts.lastEventId,
      signal: opts.signal,
      onMessage: opts.onMessage,
      onOpen: opts.onOpen,
      onClose: opts.onClose,
    });
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private async json<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.settings.apiKey}`,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) {
      const obj = (parsed ?? {}) as { error?: unknown; message?: unknown };
      const code = typeof obj.error === "string" ? obj.error : null;
      const message = typeof obj.message === "string" ? obj.message : code ?? `${res.status} ${res.statusText}`;
      const ra = res.headers.get("retry-after");
      throw new ApiError(res.status, code, message, ra ? Number(ra) : null, parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null);
    }
    return parsed as T;
  }
}

/** A human line for an API failure, in the app's voice. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "conversation_busy":
        return "The mender is still working on the last request — wait for it to finish.";
      case "provisioning":
        return "The mender's computer is still starting — try again shortly.";
      case "subscription_required":
        return "An active Fountain subscription is required.";
      case "sandbox_quota_exceeded":
        return "You are at your Fountain sandbox limit — retire a mender (or another teammate) first.";
      case "not_found":
        return "Not found.";
      default:
        if (err.status === 401) return "That API key was not accepted.";
        if (err.status === 429) return "Too many requests — slow down a little.";
        if (err.status === 503) return "Fountain could not reach the sandbox provider — try again shortly.";
        return err.message;
    }
  }
  if (err instanceof TypeError) {
    return "Could not reach Fountain. Check the URL, and that API_CORS_ORIGINS on the server includes this site.";
  }
  return err instanceof Error ? err.message : String(err);
}
