import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  /** Anthropic authenticates with this instead of a bearer token. */
  apiKey: string | undefined;
  anthropicVersion: string | undefined;
  body: unknown;
}

export interface FakeUpstream {
  /** e.g. http://127.0.0.1:41234/v1 */
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

export type UpstreamHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
) => void | Promise<void>;

/** A plausible OpenAI chat-completion payload reporting the given usage. */
export function completion(model: string, promptTokens: number, completionTokens: number): unknown {
  return {
    id: "chatcmpl-fake",
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * A plausible Anthropic messages payload reporting the given usage. Anthropic
 * splits the prompt into uncached input plus cache writes and reads, so those
 * are separate fields here rather than one total.
 */
export function message(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache: { creation?: number; read?: number } = {},
): unknown {
  return {
    id: "msg-fake",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cache.creation ?? 0,
      cache_read_input_tokens: cache.read ?? 0,
    },
  };
}

export async function startFakeUpstream(handler?: UpstreamHandler): Promise<FakeUpstream> {
  const requests: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        requests.push({
          method: req.method ?? "",
          path: req.url ?? "",
          authorization: req.headers.authorization,
          apiKey: typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined,
          anthropicVersion:
            typeof req.headers["anthropic-version"] === "string"
              ? req.headers["anthropic-version"]
              : undefined,
          body: raw === "" ? null : JSON.parse(raw),
        });

        const respond: UpstreamHandler =
          handler ??
          ((_request, response) => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(completion("gpt-4o-mini", 1000, 500)));
          });

        try {
          await respond(req, res, raw);
        } catch (error) {
          if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String(error) }));
        }
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
