#!/usr/bin/env node
// @ts-check
/**
 * SSH tunnel to an Oracle DB that is only reachable through a bastion
 * (qabis1's PDB sits in the OCI VCN). Configured in .env.local:
 *
 *   DB_TUNNEL_HOST     bastion address, e.g. 129.80.86.123
 *   DB_TUNNEL_USER     bastion login
 *   DB_TUNNEL_KEY      private key path (~ allowed)
 *   DB_TUNNEL_CERT     optional SSH certificate path (~ allowed)
 *   DB_TUNNEL_FORWARD  localPort:remoteHost:remotePort, e.g. 1821:qadb:1521
 *
 * Point GEO_DB_DSN at localhost:<localPort>/<service> so the DB helpers use it.
 * The tunnel is started in the background (ssh -f) and left running after the
 * suite finishes; it is reused by the next run.
 *
 *   node scripts/db-tunnel.js   start it if it is not up yet
 */

const net = require('net');
const os = require('os');
const { spawnSync } = require('child_process');
const { loadEnv } = require('../tests/_helpers/env');

loadEnv();

/** @param {string|undefined} p */
const expandHome = (p) => (p ? p.replace(/^~(?=$|\/)/, os.homedir()) : p);

/** @returns {null | {host:string,user:string,key?:string,cert?:string,forward:string,localPort:number}} */
function tunnelConfig() {
  const host = process.env.DB_TUNNEL_HOST;
  const forward = process.env.DB_TUNNEL_FORWARD;
  if (!host || !forward) return null;
  return {
    host,
    user: process.env.DB_TUNNEL_USER || os.userInfo().username,
    key: expandHome(process.env.DB_TUNNEL_KEY),
    cert: expandHome(process.env.DB_TUNNEL_CERT),
    forward,
    localPort: Number(forward.split(':')[0]),
  };
}

/** @param {number} port */
function isPortOpen(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (/** @type {boolean} */ ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** One-line status for the config view. */
async function tunnelStatus() {
  const t = tunnelConfig();
  if (!t) return 'not configured (DB_TUNNEL_HOST / DB_TUNNEL_FORWARD)';
  const up = await isPortOpen(t.localPort);
  return `localhost:${t.localPort} → ${t.forward.split(':').slice(1).join(':')} via ${t.user}@${t.host}  (${up ? 'up' : 'down'})`;
}

/**
 * Start the tunnel unless it is already listening.
 * @returns {Promise<boolean>} false when configured but could not be brought up
 */
async function ensureTunnel() {
  const t = tunnelConfig();
  if (!t) return true;
  if (await isPortOpen(t.localPort)) {
    console.log(`[db-tunnel] up on localhost:${t.localPort}`);
    return true;
  }
  console.log(`[db-tunnel] starting ${t.forward} via ${t.user}@${t.host}...`);
  const args = [
    '-f',
    '-N',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    ...(t.key ? ['-i', t.key] : []),
    ...(t.cert ? ['-o', `CertificateFile=${t.cert}`] : []),
    '-L',
    t.forward,
    `${t.user}@${t.host}`,
  ];
  // Inherit the terminal: ssh may need a key passphrase or a host-key answer.
  const res = spawnSync('ssh', args, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`[db-tunnel] ssh exited with ${res.status}`);
    return false;
  }
  for (let i = 0; i < 10; i += 1) {
    if (await isPortOpen(t.localPort)) {
      console.log(`[db-tunnel] up on localhost:${t.localPort}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`[db-tunnel] localhost:${t.localPort} still not listening`);
  return false;
}

module.exports = { tunnelConfig, tunnelStatus, ensureTunnel, isPortOpen };

if (require.main === module) {
  ensureTunnel().then((ok) => process.exit(ok ? 0 : 1));
}
