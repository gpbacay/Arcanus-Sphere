// The guard for the routes that give Arcanus hands on this computer (/api/device, /api/source): only a request from
// this machine may drive them. Host and x-arcanus are checked too: a site in the user's browser can't send that header
// without a CORS preflight these routes never answer, and DNS rebinding arrives with a foreign Host.
import type { NextApiRequest } from "next";

const LOOPBACK = /^(?:127\.|::1$|::ffff:127\.)/;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/** True when `req` came from this machine, to localhost, with the header only Arcanus's own page sends for `service`. */
export function fromThisMachine(req: NextApiRequest, service: string) {
  return LOOPBACK.test(req.socket.remoteAddress ?? "") && LOCAL_HOST.test(req.headers.host ?? "") && req.headers["x-arcanus"] === service;
}
