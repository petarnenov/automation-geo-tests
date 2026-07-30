#!/usr/bin/env node
// @ts-check
/**
 * Minimal client for the AIO Tests REST API.
 *
 * Auth: AIO_TOKEN env var, else a token file at ~/.aio-tests-token.
 * The token is generated in Jira under AIO Tests -> My Settings -> API Token.
 *
 * Spec: https://tcms.aiojiraapps.com/aio-tcms/api/v1/openapi.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'https://tcms.aiojiraapps.com/aio-tcms/api/v1';
const PAGE_SIZE = 100;
const TOKEN_FILE = path.join(os.homedir(), '.aio-tests-token');

function loadToken() {
  if (process.env.AIO_TOKEN && process.env.AIO_TOKEN.trim()) {
    return process.env.AIO_TOKEN.trim();
  }
  if (fs.existsSync(TOKEN_FILE)) {
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (token) return token;
  }
  throw new Error(
    'No AIO token. Generate one in Jira under AIO Tests -> My Settings -> API Token, ' +
      `then write it to ${TOKEN_FILE} or export AIO_TOKEN.`
  );
}

/**
 * @param {string} token
 * @param {string} method
 * @param {string} endpoint path below BASE, e.g. /project/GEO/testcase/search
 * @param {any} [body]
 */
async function request(token, method, endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `AioAuth ${token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `${res.status} ${res.statusText} - token rejected. Regenerate it in ` +
          `AIO Tests -> My Settings -> API Token.\n${detail}`
      );
    }
    throw new Error(`${method} ${endpoint} failed: ${res.status} ${res.statusText}\n${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * AIO search endpoints report `isLast` instead of a total, so pages are walked
 * until the API says there is nothing left.
 *
 * @param {string} token
 * @param {string} method
 * @param {string} endpoint
 * @param {any} [body]
 * @returns {Promise<any[]>}
 */
async function paginate(token, method, endpoint, body) {
  /** @type {any[]} */
  const all = [];
  let startAt = 0;
  for (;;) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const page = await request(
      token,
      method,
      `${endpoint}${sep}startAt=${startAt}&maxResults=${PAGE_SIZE}`,
      body
    );
    const items = (page && page.items) || [];
    all.push(...items);
    if (!page || page.isLast || items.length === 0) return all;
    startAt += items.length;
  }
}

module.exports = { BASE, PAGE_SIZE, TOKEN_FILE, loadToken, request, paginate };
