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

## Testing

```bash
npm test
```

Tests cover configuration parsing, validation failure scenarios, and the command service orchestration (including streaming and telemetry hooks). Linting is enforced with:

```bash
npm run lint
```

## Telemetry & Hooks

Execution telemetry is emitted through Pino. Set `REMOTE_SERVER_MCP_LOG_PATH` to write logs to a file. Pre/post/error hook callbacks are in place for future policy enforcement.

## Safety Notes

- Never commit real credentials or private keys
- Ensure host key verification paths are populated before enabling `strictHostKeyChecking`
- Use the provided hook interface to add confirmations or whitelists before deploying to production
