export type SshAuthMethod = "password" | "privateKey" | "agent";

export interface SshTunnelProfile {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  useSshConfig: boolean;
  privateKeyPath?: string;
  hasPassword: boolean;
  hasPrivateKeyPassphrase: boolean;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username?: string;
  authSource?: string;
  authMechanism?: string;
  directConnection: boolean;
  tls: boolean;
  tlsCaCert?: string;
  tlsClientCert?: string;
  replicaSet?: string;
  connectTimeoutMs?: number;
  socketTimeoutMs?: number;
  hasPassword: boolean;
  hasRawUri: boolean;
  sshTunnel?: SshTunnelProfile;
}

export interface ConnectionProfileInput extends ConnectionProfile {
  password?: string;
  rawUri?: string;
  replacePassword: boolean;
  replaceRawUri: boolean;
  sshPassword?: string;
  sshPrivateKeyPassphrase?: string;
  replaceSshPassword: boolean;
  replaceSshPrivateKeyPassphrase: boolean;
}

export interface CollectionConfig {
  name: string;        // source collection
  targetName: string;  // target collection
  keyField: string;
  selected: boolean;
  referenceFields: ReferenceFieldConfig[];
}

export interface ReferenceFieldConfig {
  localField: string;       // e.g. "app_id"
  refCollection: string;    // e.g. "appList"
  displayFields: string[];  // e.g. ["name", "version"]
}

export type DiffKind = "added" | "modified" | "deleted";

export interface DiffRecord {
  id: number;
  collection: string;
  kind: DiffKind;
  keyValue: string;
  sourceDoc: string;
  targetDoc: string;
  changedFields: string;
  selected: boolean;
  targetId: string;
  refLabels: string; // JSON string: { "app_id": { "name": "X" } }
}

export interface DiffSummary {
  collection: string;
  added: number;
  modified: number;
  deleted: number;
  totalProcessed: number;
  totalEstimated: number;
}

export interface DiffScopeStats {
  collection: string;
  kind: string;
  loadedCount: number;
  selectedCount: number;
  totalCount: number;
  hasMore: boolean;
}

export interface SelectedDiffSummary {
  collection: string;
  added: number;
  modified: number;
  deleted: number;
  totalSelected: number;
}

export interface ProgressEvent {
  collection: string;
  processed: number;
  estimated: number;
  phase: "fetching" | "diffing" | "done" | "error";
  message?: string;
}

export interface SyncResultEvent {
  collection: string;
  keyValue: string;
  kind: DiffKind;
  success: boolean;
  error?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  serverVersion?: string;
  error?: string;
}
