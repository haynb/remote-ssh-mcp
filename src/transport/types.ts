import type { HostConfig } from '../config/types.js';

export interface CommandExecutionOptions {
  timeoutMs?: number;
  stream?: boolean;
  cwd?: string;
  env?: Record<string, string>;
}

export type CommandChunkType = 'stdout' | 'stderr';

export interface CommandStreamChunk {
  type: CommandChunkType;
  data: string;
  receivedAt: Date;
}

export interface CommandExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface CommandExecutionContext {
  host: HostConfig;
  command: string;
  options: CommandExecutionOptions;
}

export interface StreamCollector {
  push(chunk: CommandStreamChunk): void;
}

export interface RemoteTransport {
  execute(
    context: CommandExecutionContext,
    collector?: StreamCollector,
  ): Promise<CommandExecutionResult>;
  dispose?(): Promise<void>;
}

export interface ConnectionPoolMetrics {
  activeConnections: number;
  idleConnections: number;
}

export interface ConnectionDiagnostics {
  hostAlias: string;
  metrics: ConnectionPoolMetrics;
}
