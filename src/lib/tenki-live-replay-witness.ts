import { randomUUID } from "node:crypto";
import type {
  ProcessRunHandle,
  ProcessRunResult,
  Session,
} from "@tenkicloud/sandbox";
import { createRuntimeSecretRedactor } from "./runtime-secret-redaction";
import { runTenkiHostCommand } from "./tenki-host-command";

const PROXY_SOURCE = String.raw`
const fs = require("node:fs");
const http = require("node:http");
const appPort = Number(process.argv[1]);
const proxyPort = Number(process.argv[2]);
const witnessPath = process.argv[3];
const server = http.createServer((request, response) => {
  if (request.headers["x-closespan-replay-probe"] !== "1") {
    fs.appendFileSync(witnessPath, "request\n", { encoding: "utf8", mode: 0o600 });
  }
  const headers = { ...request.headers, host: "127.0.0.1:" + appPort };
  delete headers["x-closespan-replay-probe"];
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: appPort,
    method: request.method,
    path: request.url,
    headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", (error) => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
    response.end("VM-local upstream failed: " + error.message);
  });
  request.pipe(upstream);
});
server.on("upgrade", (_request, socket) => socket.destroy());
server.listen(proxyPort, "127.0.0.1");
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
`;

const PROBE_SOURCE = String.raw`
const http = require("node:http");
const request = http.request({
  hostname: "127.0.0.1",
  port: Number(process.argv[1]),
  path: process.argv[2],
  method: "GET",
  headers: { "x-closespan-replay-probe": "1" },
}, (response) => {
  response.resume();
  response.on("end", () => process.exit(response.statusCode >= 200 && response.statusCode < 400 ? 0 : 2));
});
request.setTimeout(1000, () => request.destroy(new Error("probe timed out")));
request.on("error", () => process.exit(2));
request.end();
`;

type ReplaySession = Pick<Session, "run">;

function replayProxyPort(applicationPort: number): number {
  return applicationPort <= 63_999
    ? applicationPort + 1_024
    : applicationPort - 1_024;
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ settled: true as const, value })),
      new Promise<{ settled: false }>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class TenkiLiveReplayWitness {
  private readonly proxyPort: number;
  private readonly witnessPath = `/tmp/closespan-live-replay-${randomUUID()}.log`;
  private readonly redactor: ReturnType<typeof createRuntimeSecretRedactor>;
  private proxy: ProcessRunHandle | undefined;
  private proxyCompletion: Promise<ProcessRunResult> | undefined;

  constructor(
    private readonly session: ReplaySession,
    private readonly applicationPort: number,
    private readonly healthPath: string,
    private readonly workingDirectory: string,
    redactionValues: readonly string[],
  ) {
    this.proxyPort = replayProxyPort(applicationPort);
    this.redactor = createRuntimeSecretRedactor(redactionValues);
  }

  async start(): Promise<string> {
    if (this.proxy) return this.baseUrl;
    const proxy = this.session.run([
      "node",
      "-e",
      PROXY_SOURCE,
      String(this.applicationPort),
      String(this.proxyPort),
      this.witnessPath,
    ], { cwd: this.workingDirectory });
    this.proxy = proxy;
    this.proxyCompletion = Promise.resolve(proxy);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const probe = await runTenkiHostCommand(
        this.session,
        ["node", "-e", PROBE_SOURCE, String(this.proxyPort), this.healthPath],
        { cwd: this.workingDirectory, timeoutMs: 2_000, terminationGraceMs: 500 },
      );
      if (probe.exitCode === 0 && !probe.signal && !probe.timedOut) return this.baseUrl;
      const exited = await settleWithin(this.proxyCompletion, 1);
      if (exited.settled) {
        throw new Error(this.redactor.redact(
          new TextDecoder().decode(exited.value.stderr) || "VM-local replay witness exited before becoming ready",
        ));
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await this.close();
    throw new Error("VM-local replay witness did not become ready");
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.proxyPort}`;
  }

  async requestCount(): Promise<number> {
    const script = "const fs=require('node:fs');let c=0;try{c=fs.readFileSync(process.argv[1],'utf8').split('\\n').filter(Boolean).length}catch(e){if(e.code!=='ENOENT')throw e}process.stdout.write(String(c))";
    const result = await runTenkiHostCommand(
      this.session,
      ["node", "-e", script, this.witnessPath],
      { cwd: this.workingDirectory, timeoutMs: 2_000, terminationGraceMs: 500 },
    );
    if (result.exitCode !== 0 || result.signal || result.timedOut) {
      throw new Error("Could not read the VM-local replay witness");
    }
    const count = Number.parseInt(new TextDecoder().decode(result.stdout).trim(), 10);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("VM-local replay witness returned an invalid request count");
    }
    return count;
  }

  async close(): Promise<void> {
    const proxy = this.proxy;
    const completion = this.proxyCompletion;
    this.proxy = undefined;
    this.proxyCompletion = undefined;
    if (proxy && completion) {
      await proxy.signal("TERM").catch(() => undefined);
      const graceful = await settleWithin(completion, 1_000);
      if (!graceful.settled) {
        await proxy.kill().catch(() => undefined);
        const forced = await settleWithin(completion, 1_000);
        if (!forced.settled) throw new Error("VM-local replay witness did not terminate");
      }
    }
    const cleanup = "const fs=require('node:fs');try{fs.unlinkSync(process.argv[1])}catch(e){if(e.code!=='ENOENT')throw e}";
    await runTenkiHostCommand(
      this.session,
      ["node", "-e", cleanup, this.witnessPath],
      { cwd: this.workingDirectory, timeoutMs: 2_000, terminationGraceMs: 500 },
    ).catch(() => undefined);
  }
}
