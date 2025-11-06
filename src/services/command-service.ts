import { z } from 'zod';

import type { ExecutionHookManager } from '../hooks/index.js';
import { createExecutionMetadata } from '../hooks/index.js';
import type { TelemetryLogger } from '../logging/index.js';
import type { HostConfig, RemoteServerConfig } from '../config/types.js';
import type { RemoteTransport, StreamCollector } from '../transport/types.js';
import { RemoteTransportError as TransportError } from '../transport/remote-transport.js';

export interface CommandServiceOptions {
  config: RemoteServerConfig;
  transport: RemoteTransport;
  hooks: ExecutionHookManager;
  telemetry: TelemetryLogger;
}

export const runCommandArgsShape = {
  hostAlias: z.string().min(1, 'hostAlias is required'),
  command: z.string().min(1, 'command is required'),
  timeoutMs: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
} as const;

export const runCommandRequestSchema = z.object(runCommandArgsShape);

export type RunCommandRequest = z.infer<typeof runCommandRequestSchema>;

export interface RunCommandResponse {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface StreamChunkResponse {
  type: 'stdout' | 'stderr';
  data: string;
  receivedAt: string;
}

export type RunCommandStreamResponse = RunCommandResponse | StreamChunkResponse;

export type RunCommandGenerator = AsyncGenerator<RunCommandStreamResponse, void, unknown>;

class ChunkQueue<T> {
  private readonly queue: T[] = [];
  private pending: ((value: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    if (this.pending) {
      const resolve = this.pending;
      this.pending = null;
      resolve({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.pending) {
      const resolve = this.pending;
      this.pending = null;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      const value = this.queue.shift()!;
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined as unknown as T, done: true });
    }
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }
}

export class CommandService {
  private config: RemoteServerConfig;
  private readonly transport: RemoteTransport;
  private readonly hooks: ExecutionHookManager;
  private readonly telemetry: TelemetryLogger;

  constructor(options: CommandServiceOptions) {
    this.config = options.config;
    this.transport = options.transport;
    this.hooks = options.hooks;
    this.telemetry = options.telemetry;
  }

  updateConfig(config: RemoteServerConfig): void {
    this.config = config;
  }

  async *runCommand(request: unknown): RunCommandGenerator {
    const parsed = runCommandRequestSchema.safeParse(request);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
        .join('\n');
      throw new TransportError('config', `Invalid runCommand request:\n${message}`);
    }

    const input = parsed.data;
    const host = this.findHost(input.hostAlias);
    const metadata = createExecutionMetadata();
    const context = {
      host,
      command: input.command,
      options: {
        timeoutMs: input.timeoutMs,
        stream: input.stream,
        cwd: input.cwd,
        env: input.env,
      },
    } as const;

    await this.hooks.runBefore(context, metadata);
    this.telemetry.logCommandStart(context, metadata.invocationId);

    const startedAt = metadata.startedAt;

    const queue = input.stream ? new ChunkQueue<StreamChunkResponse>() : null;

    const collector: StreamCollector | undefined = {
      push: (chunk) => {
        this.telemetry.logCommandChunk(context, metadata.invocationId, chunk);
        if (queue) {
          queue.push({
            type: chunk.type,
            data: chunk.data,
            receivedAt: chunk.receivedAt.toISOString(),
          });
        }
      },
    };

    const executionPromise = this.transport.execute(context, collector);

    const finalizeResult = async (): Promise<RunCommandResponse> => {
      const executionResult = await executionPromise;
      return {
        exitCode: executionResult.exitCode,
        stdout: executionResult.stdout,
        stderr: executionResult.stderr,
        timedOut: executionResult.timedOut,
        durationMs: executionResult.durationMs,
      } satisfies RunCommandResponse;
    };

    try {
      if (queue) {
        executionPromise
          .then(() => queue.close())
          .catch(() => queue.close());

        while (true) {
          const { value, done } = await queue.next();
          if (done) {
            break;
          }
          yield value;
        }
      }

      const result = await finalizeResult();
      await this.hooks.runAfter(context, metadata, result);
      this.telemetry.logCommandResult(context, metadata.invocationId, result, startedAt);
      yield result;
    } catch (err) {
      if (queue) {
        queue.close();
      }
      const error = err instanceof Error ? err : new Error(String(err));
      await this.hooks.runError(context, metadata, error);
      this.telemetry.logCommandError(context, metadata.invocationId, error, startedAt);
      throw error;
    }
  }

  private findHost(alias: string): HostConfig {
    const host = this.config.hosts.find((entry) => entry.alias === alias);
    if (!host) {
      throw new TransportError('config', `Host alias '${alias}' not found in configuration`);
    }
    return host;
  }
}
