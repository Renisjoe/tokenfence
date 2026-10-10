import { ConfigError, loadConfig } from "./config.ts";
import { renderReport } from "./report.ts";
import { startServer } from "./server.ts";
import type { StartedServer } from "./server.ts";
import { UsageLedgerError, UsageStore } from "./store.ts";
import { SERVICE, VERSION } from "./version.ts";

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export type Command =
  | { kind: "serve"; config: string; host?: string; port?: number }
  | { kind: "report"; config: string }
  | { kind: "help" }
  | { kind: "version" };

const HELP = `tokenfence — budget enforcement for LLM API calls

Usage:
  tokenfence serve  --config <file> [--host <host>] [--port <port>]
  tokenfence report --config <file>
  tokenfence --help | --version

Commands:
  serve    Run the proxy. Serves the route matching upstream.flavor:
           POST /v1/chat/completions for "openai", or POST /v1/messages for
           "anthropic". Also GET /v1/usage and GET /healthz. Every
           authenticated call is metered against the budgets for its key.
  report   Print spend per key for today and this month from the local ledger.

Options:
  --config <file>   Path to tokenfence.config.json (required for serve/report)
  --host <host>     Override listen.host from the config
  --port <port>     Override listen.port from the config

Example:
  TOKENFENCE_UPSTREAM_KEY=sk-... tokenfence serve --config tokenfence.config.json

Docs: see README.md. Nothing leaves the machine except the upstream call you
configure — the ledger is a local JSON file.
`;

function takeValue(args: string[], flag: string, inline: string | undefined): string {
  if (inline !== undefined) {
    if (inline === "") throw new CliError(`${flag} needs a value`);
    return inline;
  }
  const next = args.shift();
  if (next === undefined || next.startsWith("--")) throw new CliError(`${flag} needs a value`);
  return next;
}

export function parseArgs(argv: string[]): Command {
  const args = [...argv];
  const command = args.shift();

  if (command === undefined || command === "-h" || command === "--help" || command === "help") {
    return { kind: "help" };
  }
  if (command === "-v" || command === "--version" || command === "version") {
    return { kind: "version" };
  }
  if (command !== "serve" && command !== "report") {
    throw new CliError(`unknown command "${command}". Run "tokenfence --help".`);
  }

  let config: string | undefined;
  let host: string | undefined;
  let port: number | undefined;

  while (args.length > 0) {
    const raw = args.shift() as string;
    const [flag, inline] = raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];

    switch (flag) {
      case "--config":
        config = takeValue(args, flag, inline);
        break;
      case "--host":
        host = takeValue(args, flag, inline);
        break;
      case "--port": {
        const value = takeValue(args, flag, inline);
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
          throw new CliError(`--port expects an integer between 0 and 65535, got "${value}"`);
        }
        port = parsed;
        break;
      }
      case "-h":
      case "--help":
        return { kind: "help" };
      default:
        throw new CliError(`unknown option "${flag}". Run "tokenfence --help".`);
    }
  }

  if (config === undefined) {
    throw new CliError(`${command} needs --config <file>`);
  }

  if (command === "serve") {
    const result: Command = { kind: "serve", config };
    if (host !== undefined) result.host = host;
    if (port !== undefined) result.port = port;
    return result;
  }
  return { kind: "report", config };
}

function waitForShutdown(started: StartedServer): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = (signal: NodeJS.Signals): void => {
      process.stdout.write(`${SERVICE}: ${signal} received, shutting down\n`);
      started.server.close(() => resolve());
      // Keep-alive sockets would otherwise hold the process open indefinitely.
      setTimeout(() => started.server.closeAllConnections(), 1000).unref();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function serve(command: Extract<Command, { kind: "serve" }>): Promise<number> {
  const config = loadConfig(command.config);
  if (command.host !== undefined) config.listen.host = command.host;
  if (command.port !== undefined) config.listen.port = command.port;

  const store = new UsageStore(config.usageFile);
  const started = await startServer({
    config,
    store,
    now: () => new Date(),
    fetchImpl: fetch,
    env: process.env,
  });

  const budgets = config.keys
    .map((key) => {
      const parts: string[] = [];
      if (key.dailyUsdBudget !== undefined) parts.push(`$${key.dailyUsdBudget}/day`);
      if (key.monthlyUsdBudget !== undefined) parts.push(`$${key.monthlyUsdBudget}/month`);
      return `${key.name} (${parts.length > 0 ? parts.join(", ") : "no budget"})`;
    })
    .join(", ");

  process.stdout.write(
    `${SERVICE} ${VERSION} listening on ${started.url}\n` +
      `  upstream    ${config.upstream.baseUrl}  (${config.upstream.flavor}, key from ${config.upstream.apiKeyEnv})\n` +
      `  ledger      ${config.usageFile}\n` +
      `  keys        ${budgets}\n` +
      `  guardrails  ${config.enforce.preflightMaxTokens ? "max_tokens pre-flight on" : "max_tokens pre-flight off"}\n\n`,
  );

  await waitForShutdown(started);
  return 0;
}

function report(command: Extract<Command, { kind: "report" }>): number {
  const config = loadConfig(command.config);
  const store = new UsageStore(config.usageFile);
  process.stdout.write(renderReport(config, store, new Date()));
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  let command: Command;
  try {
    command = parseArgs(argv);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${SERVICE}: ${reason}\n`);
    return 2;
  }

  if (command.kind === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command.kind === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  try {
    return command.kind === "serve" ? await serve(command) : report(command);
  } catch (error) {
    if (error instanceof ConfigError || error instanceof UsageLedgerError || error instanceof CliError) {
      process.stderr.write(`${SERVICE}: ${error.message}\n`);
      return 1;
    }
    const reason = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${SERVICE}: unexpected failure\n${reason}\n`);
    return 1;
  }
}
