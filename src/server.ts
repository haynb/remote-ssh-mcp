import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig, watchConfig, ConfigLoadError } from './config/loader.js';
import { ExecutionHookManager } from './hooks/index.js';
import { TelemetryLogger } from './logging/index.js';
import { CommandService, runCommandArgsShape } from './services/command-service.js';
import type { RunCommandResponse } from './services/command-service.js';
import { SshTransport } from './transport/ssh-transport.js';

const toolSchema = z.object(runCommandArgsShape);

function formatResultText(result: { exitCode: number | null; timedOut: boolean; durationMs: number }): string {
  const status = result.timedOut
    ? 'timed out'
    : result.exitCode === 0
      ? 'succeeded'
      : `exited with code ${result.exitCode ?? 'null'}`;
  return `Command ${status} in ${result.durationMs}ms`;
}

export async function bootstrap(): Promise<void> {
  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    if (error instanceof ConfigLoadError) {
      console.error(error.message);
    }
    throw error;
  }

  const hooks = new ExecutionHookManager();
  const telemetry = new TelemetryLogger();
  const transport = new SshTransport();

  const service = new CommandService({
    config,
    transport,
    hooks,
    telemetry,
  });

  const server = new McpServer(
    {
      name: 'remote-server-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: { listChanged: true },
        logging: {},
      },
    },
  );

  server.tool('runCommand', 'Execute a shell command on a configured remote host', runCommandArgsShape, async (args: z.input<typeof toolSchema>, extra: { sessionId?: string }) => {
    const request = toolSchema.parse(args);
    const iterator = service.runCommand(request);
    let lastResponse: RunCommandResponse | null = null;

    for await (const payload of iterator) {
      if ('type' in payload) {
        const level = payload.type === 'stderr' ? 'warning' : 'info';
        const message = `[${payload.type}] ${payload.data}`;
        await server.server.sendLoggingMessage(
          {
            level,
            data: message,
          },
          extra.sessionId,
        );
      } else {
        lastResponse = payload;
      }
    }

    if (!lastResponse) {
      throw new Error('Command execution did not return a result');
    }

    const isError = lastResponse.timedOut || (lastResponse.exitCode ?? 0) !== 0;

    return {
      content: [
        {
          type: 'text',
          text: [
            formatResultText(lastResponse),
            lastResponse.stdout ? `\nstdout:\n${lastResponse.stdout}` : '\nstdout: <empty>',
            lastResponse.stderr ? `\nstderr:\n${lastResponse.stderr}` : '\nstderr: <empty>',
          ].join(''),
        },
      ],
      structuredContent: {
        exitCode: lastResponse.exitCode,
        stdout: lastResponse.stdout,
        stderr: lastResponse.stderr,
        timedOut: lastResponse.timedOut,
        durationMs: lastResponse.durationMs,
      },
      isError,
    };
  });

  const transportServer = new StdioServerTransport();
  await server.connect(transportServer);

  const watcher = watchConfig(
    (nextConfig) => {
      service.updateConfig(nextConfig);
    },
    {
      onError: (err) => {
        console.error('Failed to reload configuration:', err.message);
      },
    },
  );

  const shutdown = async () => {
    await watcher.close();
    await server.close();
  };

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
}
