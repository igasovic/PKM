'use strict';

const http = require('http');
const https = require('https');

function requestJson({ method, url, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const payload = body === undefined ? null : JSON.stringify(body);

    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: method || 'GET',
      headers: {
        accept: 'application/json',
        ...(payload ? { 'content-type': 'application/json' } : {}),
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        ...(headers || {}),
      },
      timeout: Number(timeoutMs || 15000),
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
            return;
          }
        }
        resolve({
          status: Number(res.statusCode || 0),
          headers: res.headers || {},
          data: parsed,
          raw: text,
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs || 15000}ms: ${url}`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function assertOkJson(response, label) {
  if (!response || typeof response !== 'object') {
    throw new Error(`${label || 'request'}: empty response`);
  }
  const status = Number(response.status || 0);
  if (status < 200 || status >= 300) {
    const extra = response.raw ? ` body=${response.raw}` : '';
    throw new Error(`${label || 'request'} failed with HTTP ${status}.${extra}`);
  }
  if (!response.data || typeof response.data !== 'object') {
    throw new Error(`${label || 'request'} returned non-object JSON body`);
  }
  return response.data;
}

module.exports = {
  requestJson,
  assertOkJson,
};
