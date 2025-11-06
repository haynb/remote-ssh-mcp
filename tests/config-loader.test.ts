import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONFIG_ENV_VAR,
  ConfigLoadError,
  loadConfig,
} from '../src/config/loader.js';

const originalEnvPath = process.env[CONFIG_ENV_VAR];
let tempDir: string;
let configPath: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-server-mcp-test-'));
  configPath = path.join(tempDir, 'config.toml');
  process.env[CONFIG_ENV_VAR] = configPath;
});

afterEach(async () => {
  if (originalEnvPath === undefined) {
    delete process.env[CONFIG_ENV_VAR];
  } else {
    process.env[CONFIG_ENV_VAR] = originalEnvPath;
  }
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('loads and normalizes a valid configuration file', async () => {
    await fs.writeFile(
      configPath,
      `[[hosts]]\n` +
        `alias = "staging"\n` +
        `host = "staging.example.com"\n` +
        `username = "deploy"\n` +
        `[hosts.auth]\n` +
        `type = "ssh-agent"\n`,
      'utf8',
    );

    const config = await loadConfig();

    expect(config.hosts).toHaveLength(1);
    expect(config.hosts[0]).toMatchObject({
      alias: 'staging',
      host: 'staging.example.com',
      username: 'deploy',
      auth: { type: 'ssh-agent' },
      port: 22,
      strictHostKeyChecking: false,
    });
  });

  it('throws ConfigLoadError when file is missing', async () => {
    await fs.rm(configPath, { force: true });

    await expect(loadConfig()).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('surfaces validation errors with helpful message', async () => {
    await fs.writeFile(
      configPath,
      `[[hosts]]\n` +
        `alias = "broken"\n` +
        `host = "example.com"\n` +
        `[hosts.auth]\n` +
        `type = "ssh-key"\n`,
      'utf8',
    );

    await expect(loadConfig()).rejects.toThrow(/Configuration validation error/);
  });
});
