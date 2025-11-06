import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import chokidar from 'chokidar';
import { parse as parseToml } from 'toml';

import { coerceConfig } from './schema.js';
import type {
  ConfigChangeHandler,
  ConfigWatcher,
  LoadConfigOptions,
  RemoteServerConfig,
  WatchConfigOptions,
} from './types.js';

export const CONFIG_ENV_VAR = 'REMOTE_SERVER_MCP_CONFIG';
export const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  '.config',
  'remote-server-mcp',
  'config.toml',
);

export class ConfigLoadError extends Error {
  constructor(
    readonly configPath: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConfigLoadError';
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveConfigPath(options?: LoadConfigOptions): string {
  const override = options?.configPath?.trim();
  if (override) {
    return path.resolve(override);
  }

  const envOverride = process.env[CONFIG_ENV_VAR]?.trim();
  if (envOverride) {
    return path.resolve(envOverride);
  }

  return DEFAULT_CONFIG_PATH;
}

function wrapError(err: unknown, configPath: string, message: string): ConfigLoadError {
  const error = err instanceof Error ? err : new Error(String(err));
  return new ConfigLoadError(configPath, message, { cause: error });
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<RemoteServerConfig> {
  const configPath = resolveConfigPath(options);

  if (!(await fileExists(configPath))) {
    if (options.allowMissing) {
      return { hosts: [] } satisfies RemoteServerConfig;
    }

    throw new ConfigLoadError(
      configPath,
      `Configuration file not found. Expected at ${configPath}. ` +
        `Set ${CONFIG_ENV_VAR} to override the path.`,
    );
  }

  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (err) {
    throw wrapError(err, configPath, `Failed to read configuration file at ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    throw wrapError(err, configPath, `Failed to parse TOML in configuration file at ${configPath}`);
  }

  try {
    return coerceConfig(parsed);
  } catch (err) {
    throw wrapError(err, configPath, `Configuration validation error for ${configPath}`);
  }
}

export function watchConfig(
  handler: ConfigChangeHandler,
  options: WatchConfigOptions = {},
): ConfigWatcher {
  const configPath = resolveConfigPath(options);
  const debounceMs = options.debounceMs ?? 200;
  const onError = options.onError;
  let timer: NodeJS.Timeout | null = null;

  const safeInvoke = async () => {
    try {
      const config = await loadConfig({ ...options, configPath });
      await handler(config);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
    }
  };

  const scheduleReload = () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      void safeInvoke();
    }, debounceMs);
  };

  const watcher = chokidar.watch(configPath, {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 250,
      pollInterval: 100,
    },
  });

  watcher.on('add', scheduleReload);
  watcher.on('change', scheduleReload);
  watcher.on('error', (err) => onError?.(err instanceof Error ? err : new Error(String(err))));

  // Trigger initial load immediately.
  void safeInvoke();

  return {
    async close() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close();
    },
  };
}
