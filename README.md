# remote-server-mcp

A Model Context Protocol (MCP) server that lets AI agents execute shell commands on pre-configured remote machines via SSH. It validates configuration up front, streams command output, and records telemetry so future guardrails can plug in without rewriting the core transport layer.

## Prerequisites

- Node.js 20+
- Remote SSH hosts configured with credentials accessible to the machine running the MCP server

## Installation

```bash
npm install
```

## Configuration

By default the server looks for a TOML file at `~/.config/remote-server-mcp/config.toml`. Override the path with the `REMOTE_SERVER_MCP_CONFIG` environment variable if needed.

Example `config.toml`:

```toml
[[hosts]]
alias = "staging-web"
host = "staging.example.com"
username = "deploy"
auth.type = "ssh-key"
auth.privateKeyPath = "/Users/me/.ssh/id_ed25519"
knownHostsPath = "/Users/me/.ssh/known_hosts"
timeoutMs = 60000
```

Supported auth strategies:

- `ssh-key` – load a private key from disk (optional `passphrasePrompt` to read from `REMOTE_SERVER_MCP_PASSPHRASE_<ALIAS>` environment variable)
- `ssh-agent` – use the current SSH agent (`SSH_AUTH_SOCK`)
- `credential-command` – run a shell command that prints a password to stdout

Configuration hot-reloads automatically when the file changes.

## Running the server

```bash
npm run build
npm start
```

During development you can run the TypeScript sources directly:

```bash
npm run dev
```

The server currently uses the stdio MCP transport; integrate it with your MCP client by pointing at the process.

## MCP client (stdio) setup

Because the server speaks stdio, you can let your MCP client spawn it on demand instead of keeping a long-running daemon.

1. Build once with `npm run build`.
2. (Optional but convenient) run `npm link` so the `remote-server-mcp` CLI is available globally while developing.
3. In your MCP client config, define a stdio server, for example:

```toml
[[servers]]
name = "remote-server-mcp"
type = "stdio"
command = "npx"
args = ["-y", "remote-server-mcp@latest"]
startup_timeout_sec = 45

[servers.env]
REMOTE_SERVER_MCP_CONFIG = "/Users/me/.config/remote-server-mcp/config.toml"
REMOTE_SERVER_MCP_LOG_PATH = "/Users/me/.config/remote-server-mcp/server.log"
```

- Always provide `REMOTE_SERVER_MCP_CONFIG`; without it the process exits immediately (clients see `Transport closed`). `REMOTE_SERVER_MCP_LOG_PATH` keeps telemetry out of stdout so stdio framing stays valid.
- If you have not published the package yet, point `command` to `node` and pass the absolute path to `dist/index.js`, or use `command = "npx"`, `args = ["tsx", "src/index.ts"]` for live TypeScript execution.
- Each time a client session starts, it will invoke the binary, stream stdout/stderr through the MCP logging channel, and exit when the command finishes—no background service is required.

### Troubleshooting stdio launches

- **Handshake fails instantly:** confirm the MCP client is passing both `REMOTE_SERVER_MCP_CONFIG` and (optionally) `REMOTE_SERVER_MCP_LOG_PATH`. Missing config paths manifest as `connection closed: initialize response` because the server aborts before emitting any MCP frames.
- **First-time SSH prompts block execution:** set `strictHostKeyChecking = false` for the initial connection or pre-populate `known_hosts` with the remote fingerprint. Interactive "yes/no" prompts cannot be satisfied over stdio.
- **Subsequent runs hang:** multiple background `remote-server-mcp` processes contend for stdio. Use `pgrep -fl remote-server-mcp` and terminate the stale `npm exec …` / `node …` PIDs so the MCP client can spawn a fresh copy cleanly.

## Testing

```bash
npm test
```

Tests cover configuration parsing, validation failure scenarios, and the command service orchestration (including streaming and telemetry hooks). Linting is enforced with:

```bash
npm run lint
```

## Telemetry & Hooks

Execution telemetry is emitted through Pino. By default logs go to stderr (so stdio MCP transports keep stdout clean). Set `REMOTE_SERVER_MCP_LOG_PATH` to write logs to a file instead. Pre/post/error hook callbacks are in place for future policy enforcement.

## Safety Notes

- Never commit real credentials or private keys
- Ensure host key verification paths are populated before enabling `strictHostKeyChecking`
- Use the provided hook interface to add confirmations or whitelists before deploying to production
