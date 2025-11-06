import { z } from 'zod';
import type { RemoteServerConfig } from './types.js';

const sshKeyAuthSchema = z.object({
  type: z.literal('ssh-key'),
  privateKeyPath: z
    .string()
    .min(1, 'ssh-key auth requires privateKeyPath'),
  passphrasePrompt: z.boolean().optional(),
});

const sshAgentAuthSchema = z.object({
  type: z.literal('ssh-agent'),
  agentSocketPath: z.string().min(1).optional(),
});

const credentialCommandAuthSchema = z.object({
  type: z.literal('credential-command'),
  credentialCommand: z
    .string()
    .min(1, 'credential-command auth requires credentialCommand'),
});

const authSchema = z.discriminatedUnion('type', [
  sshKeyAuthSchema,
  sshAgentAuthSchema,
  credentialCommandAuthSchema,
]);

const hostConnectionOptionsSchema = z
  .object({
    keepAliveIntervalMs: z
      .number({ invalid_type_error: 'keepAliveIntervalMs must be a number' })
      .int('keepAliveIntervalMs must be an integer')
      .positive('keepAliveIntervalMs must be positive')
      .optional(),
    maxPoolSize: z
      .number({ invalid_type_error: 'maxPoolSize must be a number' })
      .int('maxPoolSize must be an integer')
      .positive('maxPoolSize must be positive')
      .optional(),
  })
  .strict();

export const hostConfigSchema = z
  .object({
    alias: z.string().min(1, 'alias is required'),
    host: z.string().min(1, 'host is required'),
    port: z
      .number({ invalid_type_error: 'port must be a number' })
      .int('port must be an integer')
      .min(1, 'port must be >= 1')
      .max(65535, 'port must be <= 65535')
      .optional(),
    username: z.string().min(1, 'username is required'),
    auth: authSchema,
    defaultShell: z.string().min(1).optional(),
    workingDirectory: z.string().min(1).optional(),
    knownHostsPath: z.string().min(1).optional(),
    strictHostKeyChecking: z.boolean().optional(),
    connection: hostConnectionOptionsSchema.optional(),
  })
  .strict();

export const remoteServerConfigSchema = z
  .object({
    hosts: z
      .array(hostConfigSchema)
      .nonempty('At least one host entry is required in config'),
  })
  .strict();

export function coerceConfig(input: unknown): RemoteServerConfig {
  const parseResult = remoteServerConfigSchema.safeParse(input);

  if (!parseResult.success) {
    const formatted = parseResult.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid remote-server-mcp configuration:\n${formatted}`);
  }

  const normalized = parseResult.data;

  return {
    hosts: normalized.hosts.map((host) => ({
      ...host,
      port: host.port ?? 22,
      strictHostKeyChecking: host.strictHostKeyChecking ?? false,
    })),
  } satisfies RemoteServerConfig;
}
