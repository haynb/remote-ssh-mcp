export type AuthType = 'ssh-key' | 'ssh-agent' | 'credential-command';

export interface SshKeyAuthConfig {
  type: 'ssh-key';
  /** Absolute path to the private key used for authentication. */
  privateKeyPath: string;
  /** Whether the runtime should prompt for a passphrase when needed. */
  passphrasePrompt?: boolean;
}

export interface SshAgentAuthConfig {
  type: 'ssh-agent';
  /** Optional explicit path to the SSH agent socket. Defaults to SSH_AUTH_SOCK. */
  agentSocketPath?: string;
}

export interface CredentialCommandAuthConfig {
  type: 'credential-command';
  /** Command to execute for retrieving credentials (e.g., from a secret manager). */
  credentialCommand: string;
}

export type AuthConfig =
  | SshKeyAuthConfig
  | SshAgentAuthConfig
  | CredentialCommandAuthConfig;

export interface HostConnectionOptions {
  keepAliveIntervalMs?: number;
  maxPoolSize?: number;
}

export interface HostConfig {
  alias: string;
  host: string;
  port?: number;
  username: string;
  auth: AuthConfig;
  defaultShell?: string;
  workingDirectory?: string;
  knownHostsPath?: string;
  strictHostKeyChecking?: boolean;
  connection?: HostConnectionOptions;
}

export interface RemoteServerConfig {
  hosts: HostConfig[];
}

export interface LoadConfigOptions {
  /** Override config path; defaults to env or standard location. */
  configPath?: string;
  /** If true, missing config file resolves to empty config instead of throwing. */
  allowMissing?: boolean;
}

export interface WatchConfigOptions extends LoadConfigOptions {
  /** Optional debounce interval in ms before emitting reloads. */
  debounceMs?: number;
  /** Optional handler invoked when loader cannot parse new config. */
  onError?: (error: Error) => void;
}

export type ConfigChangeHandler = (config: RemoteServerConfig) => void | Promise<void>;

export interface ConfigWatcher {
  close(): Promise<void>;
}
