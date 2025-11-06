import { describe, expect, it, vi } from 'vitest';

import { ExecutionHookManager } from '../src/hooks/index.js';
import { CommandService, runCommandRequestSchema } from '../src/services/command-service.js';
import type {
  CommandExecutionContext,
  CommandExecutionResult,
  RemoteTransport,
  StreamCollector,
} from '../src/transport/types.js';
import type { RemoteServerConfig } from '../src/config/types.js';
import type { TelemetryLogger } from '../src/logging/telemetry-logger.js';

const baseConfig: RemoteServerConfig = {
  hosts: [
    {
      alias: 'test-host',
      host: 'localhost',
      username: 'root',
      auth: { type: 'ssh-agent' },
    },
  ],
};

describe('CommandService', () => {
  const createTelemetryStub = () => ({
    logCommandStart: vi.fn(),
    logCommandChunk: vi.fn(),
    logCommandResult: vi.fn(),
    logCommandError: vi.fn(),
  }) as unknown as TelemetryLogger;

  const createHooks = () => {
    const hooks = {
      beforeExecute: vi.fn().mockResolvedValue(undefined),
      afterExecute: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn().mockResolvedValue(undefined),
    };

    return { hooks, manager: new ExecutionHookManager({ hooks }) };
  };

  it('streams stdout chunks and returns final result', async () => {
    const telemetry = createTelemetryStub();
    const { hooks, manager } = createHooks();

    const transport: RemoteTransport = {
      async execute(context: CommandExecutionContext, collector?: StreamCollector): Promise<CommandExecutionResult> {
        collector?.push({ type: 'stdout', data: 'hello\n', receivedAt: new Date() });
        return {
          exitCode: 0,
          stdout: 'hello\n',
          stderr: '',
          timedOut: false,
          durationMs: 10,
        };
      },
    };

    const service = new CommandService({
      config: baseConfig,
      transport,
      hooks: manager,
      telemetry,
    });

    const responses: unknown[] = [];
    for await (const payload of service.runCommand({
      hostAlias: 'test-host',
      command: 'echo hello',
      stream: true,
    })) {
      responses.push(payload);
    }

    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ type: 'stdout', data: 'hello\n' });

    expect(responses[1]).toMatchObject({
      exitCode: 0,
      stdout: 'hello\n',
      stderr: '',
      timedOut: false,
    });

    expect(hooks.beforeExecute).toHaveBeenCalledTimes(1);
    expect(hooks.afterExecute).toHaveBeenCalledTimes(1);
    expect(telemetry.logCommandChunk).toHaveBeenCalledTimes(1);
    expect(telemetry.logCommandResult).toHaveBeenCalledTimes(1);
  });

  it('throws when host alias is missing', async () => {
    const telemetry = createTelemetryStub();
    const { manager } = createHooks();

    const transport: RemoteTransport = {
      async execute() {
        throw new Error('should not execute');
      },
    };

    const service = new CommandService({
      config: baseConfig,
      transport,
      hooks: manager,
      telemetry,
    });

    const generator = service.runCommand({ hostAlias: 'unknown', command: 'ls' });
    await expect(generator.next()).rejects.toThrow(/Host alias 'unknown' not found/);
  });

  it('validates request shape', async () => {
    const telemetry = createTelemetryStub();
    const { manager } = createHooks();

    const transport: RemoteTransport = {
      async execute() {
        throw new Error('should not execute');
      },
    };

    const service = new CommandService({
      config: baseConfig,
      transport,
      hooks: manager,
      telemetry,
    });

    expect(() => runCommandRequestSchema.parse({})).toThrow();

    const generator = service.runCommand({});
    await expect(generator.next()).rejects.toThrow(/Invalid runCommand request/);
  });
});
