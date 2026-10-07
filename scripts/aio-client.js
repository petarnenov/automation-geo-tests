#!/usr/bin/env node
// @ts-check
/**
 * Minimal client for the AIO Tests REST API.
 *
 * Auth: AIO_TOKEN from .env.local (a variable exported in the shell wins).
 * The token is generated in Jira under AIO Tests -> My Settings -> API Token.
 *
 * Spec: https://tcms.aiojiraapps.com/aio-tcms/api/v1/openapi.json
 */

const { loadEnv } = require('../tests/_helpers/env');

const BASE = 'https://tcms.aiojiraapps.com/aio-tcms/api/v1';
const PAGE_SIZE = 100;

function loadToken() {
  loadEnv();
  if (process.env.AIO_TOKEN && process.env.AIO_TOKEN.trim()) {
    return process.env.AIO_TOKEN.trim();
  }
  throw new Error(
    'No AIO token. Generate one in Jira under AIO Tests -> My Settings -> API Token, ' +
      'then set AIO_TOKEN=<token> in .env.local.'
  );
}

/**
 * @param {string} token
 * @param {string} method
 * @param {string} endpoint path below BASE, e.g. /project/GEO/testcase/search
 * @param {any} [body]
 */
async function request(token, method, endpoint, body) {
  const send = () =>
    fetch(`${BASE}${endpoint}`, {
      method,
      headers: {
        Authorization: `AioAuth ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // AIO rate-limits bursts (429). Back off and retry instead of failing a
  // full-project walk halfway through.
  let res = await send();
  for (const waitMs of [5000, 15000, 30000, 60000]) {
    if (res.status !== 429) break;
    await res.text();
    await new Promise((r) => setTimeout(r, waitMs));
    res = await send();
  }

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
  const sep = endpoint.includes('?') ? '&' : '?';
  const fetchPage = (startAt, size) =>
    request(token, method, `${endpoint}${sep}startAt=${startAt}&maxResults=${size}`, body);
  let startAt = 0;
  for (;;) {
    let page;
    try {
      page = await fetchPage(startAt, PAGE_SIZE);
    } catch (err) {
      // AIO 500s a whole page when a single record in it is corrupt (seen on
      // GEO testcase/search at startAt=5600). Walk that window one record at a
      // time and skip only the records that still fail.
      if (!/failed: 500/.test(String(err.message))) throw err;
      let last = false;
      for (let i = 0; i < PAGE_SIZE; i += 1) {
        try {
          const one = await fetchPage(startAt + i, 1);
          all.push(...((one && one.items) || []));
          if (!one || one.isLast) {
            last = true;
            break;
          }
        } catch (inner) {
          if (!/failed: 500/.test(String(inner.message))) throw inner;
          console.warn(`[aio-client] skipped unreadable record at ${endpoint} #${startAt + i}`);
        }
      }
      if (last) return all;
      startAt += PAGE_SIZE;
      continue;
    }
    const items = (page && page.items) || [];
    all.push(...items);
    if (!page || page.isLast || items.length === 0) return all;
    startAt += items.length;
  }
}

module.exports = { BASE, PAGE_SIZE, loadToken, request, paginate };
