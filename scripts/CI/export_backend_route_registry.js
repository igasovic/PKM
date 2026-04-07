#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_PATH = path.join(ROOT, 'src', 'server', 'routes', 'backend-route-registry.js');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'backend_route_registry.json');

const { BACKEND_ROUTE_REGISTRY } = require(SOURCE_PATH);

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const write = args.includes('--write');

  if (check && write) {
    console.error('Use either --check or --write, not both.');
    process.exit(2);
  }

  const rendered = renderJson(BACKEND_ROUTE_REGISTRY);

  if (write) {
    fs.writeFileSync(OUTPUT_PATH, rendered, 'utf8');
    console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
    return;
  }

  if (check) {
    const existing = fs.existsSync(OUTPUT_PATH)
      ? fs.readFileSync(OUTPUT_PATH, 'utf8')
      : '';
    if (existing === rendered) {
      console.log('Backend route registry export OK');
      return;
    }
    console.log('Backend route registry JSON is out of date. Run scripts/CI/export_backend_route_registry.js --write');
    process.exit(1);
  }

  process.stdout.write(rendered);
}

main();
