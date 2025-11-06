import { pino } from 'pino';

import type {
  CommandExecutionContext,
  CommandExecutionResult,
  CommandStreamChunk,
  StreamCollector,
} from '../transport/types.js';

export const DEFAULT_LOG_PATH = process.env.REMOTE_SERVER_MCP_LOG_PATH;

export interface TelemetryLoggerOptions {
  /** Optional destination; defaults to stdout or REMOTE_SERVER_MCP_LOG_PATH if set. */
  destination?: string;
  level?: pino.LevelWithSilent;
}

export interface CommandLogContext {
  invocationId: string;
  hostAlias: string;
  command: string;
}

export interface CommandStartEvent extends CommandLogContext {
  startedAt: string;
  timeoutMs?: number;
}

export interface CommandChunkEvent extends CommandLogContext {
  chunk: CommandStreamChunk;
}

export interface CommandResultEvent extends CommandLogContext {
  finishedAt: string;
  durationMs: number;
  result: CommandExecutionResult;
}

export interface CommandErrorEvent extends CommandLogContext {
  finishedAt: string;
  durationMs: number;
  errorMessage: string;
  stack?: string;
}

export class TelemetryLogger {
  private readonly logger: pino.Logger;

  constructor(options: TelemetryLoggerOptions = {}) {
    const destination = options.destination ?? DEFAULT_LOG_PATH;
    const pinoDestination = destination ? pino.destination(destination) : undefined;

    this.logger = pino(
      {
        name: 'remote-server-mcp',
        level: options.level ?? 'info',
      },
      pinoDestination,
    );
  }

  logCommandStart(context: CommandExecutionContext, invocationId: string): void {
    const event: CommandStartEvent = {
      invocationId,
      hostAlias: context.host.alias,
      command: context.command,
      startedAt: new Date().toISOString(),
      timeoutMs: context.options.timeoutMs,
    };

    this.logger.info({ event: 'command:start', ...event }, 'Command execution started');
  }

  logCommandChunk(context: CommandExecutionContext, invocationId: string, chunk: CommandStreamChunk): void {
    const event: CommandChunkEvent = {
      invocationId,
      hostAlias: context.host.alias,
      command: context.command,
      chunk,
    };

    this.logger.debug({ event: 'command:chunk', ...event }, 'Command stream chunk');
  }

  logCommandResult(
    context: CommandExecutionContext,
    invocationId: string,
    result: CommandExecutionResult,
    startedAt: Date,
  ): void {
    const finishedAt = new Date();
    const event: CommandResultEvent = {
      invocationId,
      hostAlias: context.host.alias,
      command: context.command,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      result,
    };

    this.logger.info({ event: 'command:result', ...event }, 'Command execution finished');
  }

  logCommandError(
    context: CommandExecutionContext,
    invocationId: string,
    error: Error,
    startedAt: Date,
  ): void {
    const finishedAt = new Date();
    const event: CommandErrorEvent = {
      invocationId,
      hostAlias: context.host.alias,
      command: context.command,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      errorMessage: error.message,
      stack: error.stack,
    };

    this.logger.error({ event: 'command:error', ...event }, 'Command execution failed');
  }
}

export class TelemetryStreamCollector implements StreamCollector {
  constructor(
    private readonly context: CommandExecutionContext,
    private readonly invocationId: string,
    private readonly logger: TelemetryLogger,
  ) {}

  push(chunk: CommandStreamChunk): void {
    this.logger.logCommandChunk(this.context, this.invocationId, chunk);
  }
}
