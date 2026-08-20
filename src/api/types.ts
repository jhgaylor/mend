// Shapes as served by the Fountain API — the subset Mend uses.
// Ported from jhgaylor/dns-desk / jhgaylor/fountain-team.

export interface Conversation {
  id: string;
  title: string | null;
  agent_id: string | null;
  vault_id: string | null;
  environment_id: string | null;
  runtime: string;
  acp: boolean;
  status: "pending" | "running" | "idle" | "failed" | "terminated";
  turn_count: number;
  last_active_at: string | null;
  unread: boolean;
  inserted_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  model: string;
  runtime: string;
  environment_id: string | null;
  allowed_vault_ids: string[] | null;
  allowed_environment_ids: string[] | null;
  system?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type PresenceState =
  | "machine_offline"
  | "working"
  | "starting"
  | "online"
  | "asleep"
  | "away"
  | "failed"
  | "offline";

export interface Teammate {
  agent_id: string;
  name: string;
  agent: Agent;
  conversation: Conversation;
  presence: { state: PresenceState; label: string };
  unread: boolean;
  last_turn: {
    id: string;
    turn_number: number;
    prompt: string;
    status: string;
    inserted_at: string;
  } | null;
}

export interface Turn {
  id: string;
  turn_number: number;
  prompt: string;
  status: string;
  exit_code: number | null;
  started_at: string | null;
  ended_at: string | null;
  inserted_at: string;
}

export interface LogEvent {
  id: number;
  kind: "output" | "stage" | string;
  stream: string | null;
  data: string | null;
  stage: string | null;
  state: string | null;
  turn_id: string | null;
  ts: string;
}

/** A team-stream event: the log event plus the ids to route it. */
export interface TeamEvent extends LogEvent {
  conversation_id: string;
  agent_id: string | null;
}

export interface Me {
  id: string;
  email: string;
  role: string;
}

export interface Catalog {
  runtimes: string[];
  models: Record<string, string[]>;
}

export interface Environment {
  id: string;
  name: string;
  description?: string | null;
  networking_type?: string;
  packages?: Record<string, string[]> | null;
  setup_script?: string | null;
  agent_count?: number;
}

/** A free-floating bag of env-var overrides, attachable to one conversation. */
export interface Vault {
  id: string;
  name: string;
  description?: string | null;
  secret_count?: number;
}

/** A secret as the API returns it: the key, never the value. */
export interface SecretKey {
  key: string;
  inserted_at?: string;
  updated_at?: string;
}
