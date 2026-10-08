import { createServer } from "node:http";
import type { Server } from "node:http";

import { handleRequest } from "./proxy.ts";
import type { ProxyDeps } from "./proxy.ts";

export function createTokenFenceServer(deps: ProxyDeps): Server {
  return createServer((req, res) => {
    void handleRequest(req, res, deps);
  });
}

export interface StartedServer {
  server: Server;
  host: string;
  port: number;
  url: string;
}

/** Start listening and resolve once the socket is bound (port 0 picks a free one). */
export function startServer(deps: ProxyDeps): Promise<StartedServer> {
  const { host, port } = deps.config.listen;
  const server = createTokenFenceServer(deps);

  return new Promise<StartedServer>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const bound = typeof address === "object" && address !== null ? address.port : port;
      resolve({ server, host, port: bound, url: `http://${host}:${bound}` });
    });
  });
}
