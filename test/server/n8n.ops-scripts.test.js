'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const validateCutoverPath = path.join(repoRoot, 'scripts/n8n/validate_cutover.sh');
const runSmokePath = path.join(repoRoot, 'scripts/n8n/run_smoke.sh');

function runScript(scriptPath, args = [], env = {}) {
  const result = spawnSync(scriptPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-ops-test-'));
}

function writeFakeDocker(tempRoot) {
  const binDir = path.join(tempRoot, 'bin');
  const dockerPath = path.join(binDir, 'docker');
  fs.mkdirSync(binDir, { recursive: true });

  fs.writeFileSync(
    dockerPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'args="$*"',
      'case "$args" in',
      '  "inspect --format {{.State.Status}} n8n") echo "running" ;;',
      '  "inspect --format {{.State.Status}} n8n-runners") echo "running" ;;',
      '  "inspect --format {{.Config.Image}} n8n") echo "docker.n8n.io/n8nio/n8n:2.10.3" ;;',
      '  "inspect --format {{.Config.Image}} n8n-runners") echo "pkm-n8n-runners:2.10.3" ;;',
      '  "exec n8n printenv N8N_EDITOR_BASE_URL") echo "https://n8n.gasovic.com" ;;',
      '  "exec n8n printenv WEBHOOK_URL") echo "https://n8n-hook.gasovic.com/" ;;',
      '  "exec n8n printenv N8N_PROXY_HOPS") echo "1" ;;',
      '  "exec n8n printenv N8N_RUNNERS_MODE") echo "external" ;;',
      '  "exec n8n printenv NODE_FUNCTION_ALLOW_EXTERNAL") echo "@igasovic/n8n-blocks,igasovic-n8n-blocks" ;;',
      '  "exec n8n-runners printenv N8N_RUNNERS_TASK_BROKER_URI") echo "http://n8n:5679" ;;',
      '  "exec n8n-runners printenv N8N_RUNNERS_AUTH_TOKEN") echo "runner-secret" ;;',
      '  "exec n8n-runners cat /etc/n8n-task-runners.json") printf "{\\"task-runners\\":[{\\"runner-type\\":\\"javascript\\",\\"workdir\\":\\"/home/runner\\",\\"command\\":\\"/usr/local/bin/node\\",\\"args\\":[\\"--disallow-code-generation-from-strings\\",\\"--disable-proto=delete\\",\\"/opt/runners/task-runner-javascript/dist/start.js\\"],\\"health-check-server-port\\":\\"5681\\",\\"env-overrides\\":{\\"NODE_FUNCTION_ALLOW_BUILTIN\\":\\"crypto,node:path,node:process\\",\\"NODE_FUNCTION_ALLOW_EXTERNAL\\":\\"@igasovic/n8n-blocks,igasovic-n8n-blocks\\"}},{\\"runner-type\\":\\"python\\",\\"workdir\\":\\"/home/runner\\",\\"command\\":\\"/opt/runners/task-runner-python/.venv/bin/python\\",\\"args\\":[\\"-I\\",\\"-B\\",\\"-X\\",\\"disable_remote_debug\\",\\"-m\\",\\"src.main\\"],\\"health-check-server-port\\":\\"5682\\",\\"env-overrides\\":{\\"N8N_RUNNERS_STDLIB_ALLOW\\":\\"\\",\\"N8N_RUNNERS_EXTERNAL_ALLOW\\":\\"\\"}}]}" ;;',
      '  "exec n8n-runners sh -lc test -f /usr/local/lib/node_modules/n8n/node_modules/@igasovic/n8n-blocks/package.json && printf %s /usr/local/lib/node_modules/n8n/node_modules/@igasovic/n8n-blocks/package.json") echo "/usr/local/lib/node_modules/n8n/node_modules/@igasovic/n8n-blocks/package.json" ;;',
      '  "exec n8n-runners sh -lc test -f /usr/local/lib/node_modules/n8n/node_modules/igasovic-n8n-blocks/package.json && printf %s /usr/local/lib/node_modules/n8n/node_modules/igasovic-n8n-blocks/package.json") echo "/usr/local/lib/node_modules/n8n/node_modules/igasovic-n8n-blocks/package.json" ;;',
      '  "exec n8n-runners sh -lc test -f /opt/runners/task-runner-javascript/node_modules/@igasovic/n8n-blocks/package.json && printf %s /opt/runners/task-runner-javascript/node_modules/@igasovic/n8n-blocks/package.json") echo "/opt/runners/task-runner-javascript/node_modules/@igasovic/n8n-blocks/package.json" ;;',
      '  "exec -u node n8n n8n --help") echo "n8n help" ;;',
      '  *)',
      '    echo "unexpected docker invocation: $args" >&2',
      '    exit 1',
      '    ;;',
      'esac',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(dockerPath, 0o755);

  return binDir;
}

function writeFakeGitAndCurl(tempRoot) {
  const binDir = path.join(tempRoot, 'bin');
  const gitPath = path.join(binDir, 'git');
  const curlPath = path.join(binDir, 'curl');
  fs.mkdirSync(binDir, { recursive: true });

  fs.writeFileSync(
    gitPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(gitPath, 0o755);

  fs.writeFileSync(
    curlPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'args="$*"',
      'if [[ "$args" == *"/api/v1/workflows?limit=1"* ]]; then',
      '  printf "HTTP 200\\n"',
      '  exit 0',
      'fi',
      'if [[ "$args" == *"/api/v1/workflows/"*"/run"* ]]; then',
      '  out=""',
      '  while [[ $# -gt 0 ]]; do',
      '    if [[ "$1" == "-o" ]]; then',
      '      out="${2:-}"',
      '      shift 2',
      '      continue',
      '    fi',
      '    shift',
      '  done',
      '  if [[ -n "$out" ]]; then',
      '    printf "{\\"executionId\\":\\"smoke-exec-1\\",\\"status\\":\\"running\\"}" > "$out"',
      '  fi',
      '  printf "200"',
      '  exit 0',
      'fi',
      'echo "unexpected curl invocation: $args" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(curlPath, 0o755);

  return binDir;
}

describe('n8n operator scripts', () => {
  test('run_smoke.sh prints help without requiring docker', () => {
    const res = runScript(runSmokePath, ['--help']);
    expect(res.code).toBe(0);
    expect(res.stderr).toContain('Usage: scripts/n8n/run_smoke.sh');
    expect(res.stderr).toContain('SMOKE_WORKFLOW_ID');
  });

  test('run_smoke.sh triggers smoke workflow via n8n API', () => {
    const tempRoot = makeTempRoot();
    const binDir = writeFakeGitAndCurl(tempRoot);

    const res = runScript(runSmokePath, [], {
      PATH: `${binDir}:${process.env.PATH}`,
      GIT_PULL_MODE: 'none',
      N8N_API_BASE_URL: 'http://127.0.0.1:5678',
      N8N_API_KEY: 'test-api-key',
      SMOKE_WORKFLOW_ID: 'wf-smoke-1',
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('[smoke 2/3] Waiting for n8n API to be ready');
    expect(res.stdout).toContain('Smoke workflow trigger accepted (HTTP 200).');
    expect(res.stdout).toContain('"executionId":"smoke-exec-1"');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('validate_cutover.sh validates expected runtime state against fake docker', () => {
    const tempRoot = makeTempRoot();
    const composeFile = path.join(tempRoot, 'docker-compose.yml');
    const binDir = writeFakeDocker(tempRoot);

    fs.writeFileSync(
      composeFile,
      [
        'services:',
        '  n8n:',
        '    image: docker.n8n.io/n8nio/n8n:2.10.3',
        '  task-runners:',
        '    image: pkm-n8n-runners:2.10.3',
        '    volumes:',
        '      - ./n8n-task-runners.json:/etc/n8n-task-runners.json:ro',
        '',
      ].join('\n'),
      'utf8',
    );

    const res = runScript(validateCutoverPath, [], {
      PATH: `${binDir}:${process.env.PATH}`,
      COMPOSE_FILE: composeFile,
      RUN_SMOKE_SCRIPT: runSmokePath,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('OK: n8n image = docker.n8n.io/n8nio/n8n:2.10.3');
    expect(res.stdout).toContain('OK: n8n-runners image = pkm-n8n-runners:2.10.3');
    expect(res.stdout).toContain('OK: runners launcher config includes expected JS allowlists');
    expect(res.stdout).toContain('OK: runners scoped package path = /usr/local/lib/node_modules/n8n/node_modules/@igasovic/n8n-blocks/package.json');
    expect(res.stdout).toContain('OK: runners alias package path = /usr/local/lib/node_modules/n8n/node_modules/igasovic-n8n-blocks/package.json');
    expect(res.stdout).toContain('OK: runners js-task-runner scoped package path = /opt/runners/task-runner-javascript/node_modules/@igasovic/n8n-blocks/package.json');
    expect(res.stdout).toContain('Smoke execution skipped');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('validate_cutover.sh --with-smoke invokes run_smoke helper', () => {
    const tempRoot = makeTempRoot();
    const composeFile = path.join(tempRoot, 'docker-compose.yml');
    const binDir = writeFakeDocker(tempRoot);
    const smokeScript = path.join(tempRoot, 'fake-run-smoke.sh');
    const smokeLog = path.join(tempRoot, 'smoke.log');

    fs.writeFileSync(
      composeFile,
      [
        'services:',
        '  n8n:',
        '    image: docker.n8n.io/n8nio/n8n:2.10.3',
        '  task-runners:',
        '    image: pkm-n8n-runners:2.10.3',
        '    volumes:',
        '      - ./n8n-task-runners.json:/etc/n8n-task-runners.json:ro',
        '',
      ].join('\n'),
      'utf8',
    );

    fs.writeFileSync(
      smokeScript,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'printf "GIT_PULL_MODE=%s\\n" "${GIT_PULL_MODE:-}" > "$SMOKE_LOG_PATH"',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.chmodSync(smokeScript, 0o755);

    const res = runScript(validateCutoverPath, ['--with-smoke'], {
      PATH: `${binDir}:${process.env.PATH}`,
      COMPOSE_FILE: composeFile,
      RUN_SMOKE_SCRIPT: smokeScript,
      SMOKE_LOG_PATH: smokeLog,
    });

    expect(res.code).toBe(0);
    expect(fs.readFileSync(smokeLog, 'utf8')).toContain('GIT_PULL_MODE=none');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
