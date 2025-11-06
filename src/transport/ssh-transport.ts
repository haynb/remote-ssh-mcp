import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { Client, type ConnectConfig } from 'ssh2';

import type { HostConfig } from '../config/types.js';
import {
  type CommandExecutionContext,
  type CommandExecutionResult,
  type CommandStreamChunk,
  type StreamCollector,
  type RemoteTransport,
} from './types.js';
import { RemoteTransportError, enrichError } from './remote-transport.js';

const execPromise = promisify(execCallback);

interface ExecutionState {
  stdout: string[];
  stderr: string[];
  timedOut: boolean;
}

interface KnownHostEntry {
  hostnames: string[];
  key: string; // base64 encoded
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadKnownHostsEntries(filePath: string): Promise<KnownHostEntry[]> {
  if (!(await fileExists(filePath))) {
    throw new RemoteTransportError(
      'config',
      `Known hosts file not found at ${filePath}. Provide a valid path or disable strictHostKeyChecking.`,
    );
  }

  const raw = await fs.readFile(filePath, 'utf-8');
  const entries: KnownHostEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.startsWith('@') || trimmed.startsWith('|')) {
      // Skip cert-authority directives and hashed entries for now.
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) {
      continue;
    }

    const [hostList, , key] = parts;
    if (!hostList || !key) {
      continue;
    }

    entries.push({
      hostnames: hostList.split(','),
      key,
    });
  }

  return entries;
}

function resolveKnownHostsPath(host: HostConfig): string {
  if (host.knownHostsPath) {
    return path.resolve(host.knownHostsPath);
  }
  return path.join(os.homedir(), '.ssh', 'known_hosts');
}

function buildHostCandidates(host: HostConfig): string[] {
  const candidates = new Set<string>();
  const hostname = host.host;
  const port = host.port ?? 22;

  candidates.add(hostname);
  candidates.add(`${hostname}:${port}`);
  candidates.add(`[${hostname}]:${port}`);
  candidates.add(host.alias);

  return Array.from(candidates).filter(Boolean) as string[];
}

async function createHostVerifier(host: HostConfig): Promise<((key: Buffer) => boolean) | undefined> {
  if (host.strictHostKeyChecking === false) {
    return undefined;
  }

  const knownHostsPath = resolveKnownHostsPath(host);
  const entries = await loadKnownHostsEntries(knownHostsPath);
  if (entries.length === 0) {
    throw new RemoteTransportError(
      'config',
      `No entries found in known hosts file ${knownHostsPath}; cannot verify ${host.alias}.`,
    );
  }

  const candidates = buildHostCandidates(host);

  return (key: Buffer) => {
    const base64 = key.toString('base64');
    return entries.some((entry) => {
      if (!entry.hostnames.some((name) => candidates.includes(name))) {
        return false;
      }
      return entry.key === base64;
    });
  };
}

function pushChunk(collector: StreamCollector | undefined, chunk: CommandStreamChunk): void {
  collector?.push(chunk);
}

async function resolveAuthConfig(host: HostConfig): Promise<Partial<ConnectConfig>> {
  const auth = host.auth;

  switch (auth.type) {
    case 'ssh-key': {
      const privateKey = await fs.readFile(auth.privateKeyPath);
      const passphrase = auth.passphrasePrompt
        ? process.env[`REMOTE_SERVER_MCP_PASSPHRASE_${host.alias.toUpperCase()}`]
        : undefined;
      return {
        privateKey,
        passphrase,
      };
    }
    case 'ssh-agent': {
      const agent = auth.agentSocketPath ?? process.env.SSH_AUTH_SOCK;
      if (!agent) {
        throw new RemoteTransportError(
          'auth',
          `SSH agent authentication requested for ${host.alias} but no agent socket is available`,
        );
      }
      return { agent };
    }
    case 'credential-command': {
      const { stdout } = await execPromise(auth.credentialCommand, {
        maxBuffer: 8 * 1024,
      });
      const password = stdout.trim();
      if (!password) {
        throw new RemoteTransportError(
          'auth',
          `Credential command for ${host.alias} returned empty output`,
        );
      }
      return { password };
    }
    default: {
      const exhaustive: never = auth;
      throw new Error(`Unsupported auth type: ${exhaustive}`);
    }
  }
}

function buildConnectConfig(host: HostConfig): ConnectConfig {
  return {
    host: host.host,
    port: host.port ?? 22,
    username: host.username,
    keepaliveInterval: host.connection?.keepAliveIntervalMs,
    readyTimeout: 20_000,
  };
}

function applyCwd(command: string, cwd: string | undefined): string {
  if (!cwd) {
    return command;
  }

  const escapedCwd = cwd.replace(/'/g, "'\\''");
  return `cd '${escapedCwd}' && ${command}`;
}

export class SshTransport implements RemoteTransport {
  async execute(
    context: CommandExecutionContext,
    collector?: StreamCollector,
  ): Promise<CommandExecutionResult> {
    const { host, command, options } = context;
    const start = Date.now();
    const ssh = new Client();
    const state: ExecutionState = {
      stdout: [],
      stderr: [],
      timedOut: false,
    };

    const timeoutMs = options.timeoutMs ?? 60_000;
    let timeoutId: NodeJS.Timeout | undefined;

    let resolvedAuth: Partial<ConnectConfig>;
    try {
      resolvedAuth = await resolveAuthConfig(host);
    } catch (err) {
      throw enrichError(err, 'auth', host.alias);
    }

    let hostVerifier: ((key: Buffer) => boolean) | undefined;
    try {
      hostVerifier = await createHostVerifier(host);
    } catch (err) {
      throw enrichError(err, 'config', host.alias);
    }

    const connectConfig: ConnectConfig = {
      ...buildConnectConfig(host),
      ...resolvedAuth,
      hostVerifier,
    };

    const connectPromise = new Promise<void>((resolve, reject) => {
      ssh
        .on('ready', () => resolve())
        .on('error', (error) => reject(enrichError(error, 'connection', host.alias)));
    });

    ssh.connect(connectConfig);

    try {
      await connectPromise;
    } catch (err) {
      ssh.end();
      throw err;
    }

    const execCommand = applyCwd(command, options.cwd ?? host.workingDirectory);

    const execution = new Promise<CommandExecutionResult>((resolve, reject) => {
      ssh.exec(
        execCommand,
        {
          env: options.env,
        },
        (execErr, stream) => {
          if (execErr) {
            reject(enrichError(execErr, 'execution', host.alias));
            ssh.end();
            return;
          }

          timeoutId = setTimeout(() => {
            state.timedOut = true;
            stream.close();
          }, timeoutMs);

          stream
            .on('data', (chunk: Buffer) => {
              const data = chunk.toString();
              state.stdout.push(data);
              pushChunk(collector, {
                type: 'stdout',
                data,
                receivedAt: new Date(),
              });
            })
            .stderr.on('data', (chunk: Buffer) => {
              const data = chunk.toString();
              state.stderr.push(data);
              pushChunk(collector, {
                type: 'stderr',
                data,
                receivedAt: new Date(),
              });
            });

          stream.on('close', (code: number | null) => {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }

            ssh.end();

            const durationMs = Date.now() - start;

            if (state.timedOut) {
              resolve({
                exitCode: null,
                stdout: state.stdout.join(''),
                stderr: state.stderr.join(''),
                timedOut: true,
                durationMs,
              });
              return;
            }

            resolve({
              exitCode: code,
              stdout: state.stdout.join(''),
              stderr: state.stderr.join(''),
              timedOut: false,
              durationMs,
            });
          });

          stream.on('error', (streamErr: Error) => {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            ssh.end();
            reject(enrichError(streamErr, 'execution', host.alias));
          });
        },
      );
    });

    try {
      return await execution;
    } catch (err) {
      throw err;
    }
  }
}
