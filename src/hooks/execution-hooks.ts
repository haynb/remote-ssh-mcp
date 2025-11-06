import { nanoid } from 'nanoid/non-secure';

import type { CommandExecutionContext, CommandExecutionResult } from '../transport/types.js';

export interface ExecutionContextMetadata {
  /** Opaque identifier for correlating logs and hooks. */
  invocationId: string;
  /** Timestamp when execution started. */
  startedAt: Date;
}

export interface ExecutionHookArgs {
  context: CommandExecutionContext;
  metadata: ExecutionContextMetadata;
}

export interface ExecutionHookResultArgs extends ExecutionHookArgs {
  result: CommandExecutionResult;
}

export interface ExecutionHookErrorArgs extends ExecutionHookArgs {
  error: Error;
}

export interface ExecutionHooks {
  beforeExecute(args: ExecutionHookArgs): Promise<void>;
  afterExecute(args: ExecutionHookResultArgs): Promise<void>;
  onError(args: ExecutionHookErrorArgs): Promise<void>;
}

export class NoopExecutionHooks implements ExecutionHooks {
  async beforeExecute(): Promise<void> {
    // intentionally empty hook
  }

  async afterExecute(): Promise<void> {
    // intentionally empty hook
  }

  async onError(): Promise<void> {
    // intentionally empty hook
  }
}

export function createExecutionMetadata(): ExecutionContextMetadata {
  return {
    invocationId: nanoid(12),
    startedAt: new Date(),
  };
}

export interface HookManagerOptions {
  hooks?: ExecutionHooks;
}

export class ExecutionHookManager {
  private readonly hooks: ExecutionHooks;

  constructor(options: HookManagerOptions = {}) {
    this.hooks = options.hooks ?? new NoopExecutionHooks();
  }

  async runBefore(context: CommandExecutionContext, metadata: ExecutionContextMetadata): Promise<void> {
    await this.hooks.beforeExecute({ context, metadata });
  }

  async runAfter(
    context: CommandExecutionContext,
    metadata: ExecutionContextMetadata,
    result: CommandExecutionResult,
  ): Promise<void> {
    await this.hooks.afterExecute({ context, metadata, result });
  }

  async runError(
    context: CommandExecutionContext,
    metadata: ExecutionContextMetadata,
    error: Error,
  ): Promise<void> {
    await this.hooks.onError({ context, metadata, error });
  }
}
