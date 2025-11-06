# Tasks Document

- [x] 1. Establish project scaffolding and dependencies
  - File(s): package.json, tsconfig.json, src/index.ts
  - Actions: Initialize Node/TypeScript project, install MCP SDK, ssh2, zod, logging, and utility libraries; set up lint/test scripts.
  - Purpose: Provide baseline structure to implement the MCP server.
  - _Requirements: 1, 2_
  - _Prompt: Role: Tooling engineer experienced with MCP servers | Task: Bootstrap TypeScript MCP project with required dependencies and entry point wiring for future components | Restrictions: Keep dependency list minimal, ensure TypeScript strict mode enabled | Success: Project builds, lint/test scripts run, entry point logs ready state._

- [x] 2. Implement configuration loader and schema validation
  - File(s): src/config/schema.ts, src/config/loader.ts, src/config/types.ts
  - Actions: Define HostConfig schema (zod), parse `config.toml` from `~/.config/remote-server-mcp/`, expose reload/watch capability.
  - Purpose: Ensure remote hosts and auth settings are validated before command execution.
  - _Requirements: 2_
  - _Prompt: Role: Backend TypeScript engineer | Task: Build robust loader validating config and surfacing errors with remediation hints | Restrictions: No plaintext secrets stored in repo, support overriding config path via env var | Success: Loader returns typed config, rejects invalid entries, supports hot reload callback._

- [x] 3. Create SSH transport layer with command execution helpers
  - File(s): src/transport/remote-transport.ts, src/transport/ssh-transport.ts, src/transport/types.ts
  - Actions: Define `RemoteTransport` interface; implement SSH transport using ssh2 with connection pooling and per-command channels; handle timeouts and stdout/stderr streaming.
  - Purpose: Provide abstraction for executing commands on remote servers.
  - _Requirements: 1, 2_
  - _Prompt: Role: Node.js engineer familiar with SSH | Task: Implement transport that supports both buffered and streaming execution with configurable timeouts | Restrictions: Avoid global state, ensure proper cleanup on errors | Success: Commands execute successfully against mock SSH server, handles auth failure and timeouts gracefully._

- [x] 4. Add execution hooks and telemetry logging
  - File(s): src/hooks/execution-hooks.ts, src/logging/telemetry-logger.ts
  - Actions: Expose pre/post hook interface with no-op default implementation; implement structured logging (JSON) capturing command start/end, errors, durations.
  - Purpose: Provide observability and future guardrail integration points.
  - _Requirements: 3_
  - _Prompt: Role: Observability-focused engineer | Task: Instrument command lifecycle with logs and hook callbacks | Restrictions: Hooks must be async-safe, logging should handle rotation/size via existing library defaults | Success: Logs show expected fields, hook stubs invoked during execution._

- [x] 5. Implement MCP command service and tool wiring
  - File(s): src/services/command-service.ts, src/server.ts
  - Actions: Implement `runCommand` handler that validates request, resolves host, invokes transport, streams/buffers results, invokes hooks/logging; bootstrap MCP server registering the tool.
  - Purpose: Expose functionality to AI clients via MCP.
  - _Requirements: 1, 3_
  - _Prompt: Role: MCP integration engineer | Task: Wire command service into MCP server with error mapping and structured responses | Restrictions: Maintain clear error codes/messages, support streaming via async generator | Success: MCP client can run commands on configured hosts and receive structured output/errors._

- [x] 6. Testing and documentation
  - File(s): tests/config-loader.test.ts, tests/ssh-transport.test.ts, tests/command-service.test.ts, README.md
  - Actions: Write unit/integration tests using mock SSH server; document configuration format, execution flow, and safety considerations.
  - Purpose: Validate functionality and guide adopters.
  - _Requirements: All_
  - _Prompt: Role: QA/Docs engineer | Task: Provide coverage for critical paths and clear setup docs | Restrictions: Tests must run locally without real secrets, doc examples must avoid exposing credentials | Success: Tests pass in CI, README describes setup/run steps._
