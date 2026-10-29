// Inside the sandbox: expose the daemon's per-run gateway socket as
// 127.0.0.1:8080, so Claude Code's ANTHROPIC_BASE_URL can point at it while the
// container itself has no network (--network none still has loopback).
import net from "node:net";

const SOCKET = "/run/celiador/gw.sock";
net
  .createServer((inbound) => {
    const outbound = net.connect(SOCKET);
    inbound.pipe(outbound).pipe(inbound);
    const close = () => { inbound.destroy(); outbound.destroy(); };
    inbound.on("error", close);
    outbound.on("error", close);
  })
  .listen(8080, "127.0.0.1");
