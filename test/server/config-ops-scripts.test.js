'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const checkcfgPath = path.join(repoRoot, 'scripts/cfg/checkcfg');
const updatecfgPath = path.join(repoRoot, 'scripts/cfg/updatecfg');
const importcfgPath = path.join(repoRoot, 'scripts/cfg/importcfg');
const bootstrapcfgPath = path.join(repoRoot, 'scripts/cfg/bootstrapcfg');

function runScript(scriptPath, args = [], env = {}) {
  try {
    const stdout = execFileSync(scriptPath, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || ''),
    };
  }
}

function makeTempRoots() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-ops-test-'));
  const tempRepoRoot = path.join(tempRoot, 'repo');
  const tempStackRoot = path.join(tempRoot, 'stack');

  fs.mkdirSync(tempRepoRoot, { recursive: true });
  fs.mkdirSync(tempStackRoot, { recursive: true });

  return { tempRoot, tempRepoRoot, tempStackRoot };
}

function setupFakeDocker(tempRoot, servicesOutput = 'pkm-server\nn8n\n') {
  const fakeBinDir = path.join(tempRoot, 'bin');
  const fakeDockerPath = path.join(fakeBinDir, 'docker');
  const dockerLogPath = path.join(tempRoot, 'docker.log');
  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.writeFileSync(
    fakeDockerPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'echo "$*" >> "$FAKE_DOCKER_LOG"',
      'if [[ "$*" == *" config --services"* ]]; then',
      '  printf "%s" "$FAKE_DOCKER_SERVICES"',
      '  exit 0',
      'fi',
      'if [[ "$*" == *" up -d"* ]]; then',
      '  echo "compose apply ok"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(fakeDockerPath, 0o755);

  return {
    fakeBinDir,
    dockerLogPath,
    dockerEnv: {
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      FAKE_DOCKER_LOG: dockerLogPath,
      FAKE_DOCKER_SERVICES: servicesOutput,
    },
  };
}

describe('config ops scripts', () => {
  test('checkcfg requires exactly one surface argument', () => {
    const res = runScript(checkcfgPath, []);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Usage: checkcfg <surface>');
    expect(res.stderr).toContain('Supported surfaces:');
  });

  test('checkcfg rejects unknown surfaces clearly', () => {
    const res = runScript(checkcfgPath, ['unknown-surface']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Unknown surface: unknown-surface');
    expect(res.stderr).toContain('- n8n');
    expect(res.stderr).toContain('- litellm');
  });

  test('updatecfg requires exactly one surface argument', () => {
    const res = runScript(updatecfgPath, ['litellm', 'docker']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Usage: updatecfg <surface>');
  });

  test('updatecfg rejects unknown options', () => {
    const res = runScript(updatecfgPath, ['litellm', '--sideways']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Unknown option: --sideways');
    expect(res.stderr).toContain('Usage: updatecfg <surface> [--push|--pull]');
  });

  test('updatecfg rejects conflicting --push and --pull', () => {
    const res = runScript(updatecfgPath, ['litellm', '--push', '--pull']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('mutually exclusive');
  });

  test('importcfg requires exactly one surface argument', () => {
    const res = runScript(importcfgPath, []);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Usage: importcfg <surface>');
    expect(res.stderr).toContain('Supported surfaces:');
  });

  test('importcfg rejects unknown options', () => {
    const res = runScript(importcfgPath, ['--pull']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Unknown option: --pull');
    expect(res.stderr).toContain('Usage: importcfg <surface>');
  });

  test('bootstrapcfg rejects backend surface', () => {
    const res = runScript(bootstrapcfgPath, ['--surface', 'backend']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('does not support backend import');
  });

  test('importcfg rejects unknown surfaces clearly', () => {
    const res = runScript(importcfgPath, ['unknown-surface']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Unknown surface: unknown-surface');
    expect(res.stderr).toContain('- backend');
  });

  test('checkcfg litellm returns clean when repo and runtime match', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();
    const repoFile = path.join(tempRepoRoot, 'ops/stack/litellm/config.yaml');
    const runtimeFile = path.join(tempStackRoot, 'litellm/config.yaml');

    fs.mkdirSync(path.dirname(repoFile), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });

    const payload = 'model_list:\n  - model_name: t1-default\n';
    fs.writeFileSync(repoFile, payload, 'utf8');
    fs.writeFileSync(runtimeFile, payload, 'utf8');

    const res = runScript(checkcfgPath, ['litellm'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Surface: litellm');
    expect(res.stdout).toContain('Status: clean');
    expect(res.stdout).toContain('Next command: none (surface is clean)');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('checkcfg litellm returns drifted when repo and runtime differ', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();
    const repoFile = path.join(tempRepoRoot, 'ops/stack/litellm/config.yaml');
    const runtimeFile = path.join(tempStackRoot, 'litellm/config.yaml');

    fs.mkdirSync(path.dirname(repoFile), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });

    fs.writeFileSync(repoFile, 'model_list:\n  - model_name: t1-default\n', 'utf8');
    fs.writeFileSync(runtimeFile, 'model_list:\n  - model_name: t1-cheap\n', 'utf8');

    const res = runScript(checkcfgPath, ['litellm'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
    });

    expect(res.code).toBe(3);
    expect(res.stdout).toContain('Surface: litellm');
    expect(res.stdout).toContain('Status: drifted');
    expect(res.stdout).toContain('Next command: updatecfg litellm');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('checkcfg docker reports affected service for drifted service env file', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();

    const repoCompose = path.join(tempRepoRoot, 'ops/stack/docker-compose.yml');
    const runtimeCompose = path.join(tempStackRoot, 'docker-compose.yml');
    const repoEnvDir = path.join(tempRepoRoot, 'ops/stack/env');
    const repoEnv = path.join(repoEnvDir, 'pkm-server.env');
    const runtimeEnv = path.join(tempStackRoot, 'pkm-server.env');

    fs.mkdirSync(path.dirname(repoCompose), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeCompose), { recursive: true });
    fs.mkdirSync(repoEnvDir, { recursive: true });

    const composePayload = [
      'services:',
      '  pkm-server:',
      '    image: example/pkm-server',
      '  n8n:',
      '    image: example/n8n',
      '',
    ].join('\n');

    fs.writeFileSync(repoCompose, composePayload, 'utf8');
    fs.writeFileSync(runtimeCompose, composePayload, 'utf8');
    fs.writeFileSync(repoEnv, 'PKM_FEATURE_X=true\n', 'utf8');
    fs.writeFileSync(runtimeEnv, 'PKM_FEATURE_X=false\n', 'utf8');

    const fakeDocker = setupFakeDocker(tempRoot, 'pkm-server\nn8n\n');
    const res = runScript(checkcfgPath, ['docker'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
      ...fakeDocker.dockerEnv,
    });

    expect(res.code).toBe(3);
    expect(res.stdout).toContain('Surface: docker');
    expect(res.stdout).toContain('Status: drifted');
    expect(res.stdout).toContain('docker affected services: pkm-server');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('updatecfg litellm pull mode copies runtime config into repo', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();
    const repoFile = path.join(tempRepoRoot, 'ops/stack/litellm/config.yaml');
    const runtimeFile = path.join(tempStackRoot, 'litellm/config.yaml');

    fs.mkdirSync(path.dirname(repoFile), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });

    fs.writeFileSync(repoFile, 'model_list:\n  - model_name: old\n', 'utf8');
    fs.writeFileSync(runtimeFile, 'model_list:\n  - model_name: from_runtime\n', 'utf8');

    const res = runScript(updatecfgPath, ['litellm', '--pull'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Surface: litellm');
    expect(res.stdout).toContain('Mode: pull');
    expect(res.stdout).toContain('Status: ok');

    const updatedRepo = fs.readFileSync(repoFile, 'utf8');
    expect(updatedRepo).toContain('from_runtime');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('importcfg litellm pulls runtime config into repo', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();
    const repoFile = path.join(tempRepoRoot, 'ops/stack/litellm/config.yaml');
    const runtimeFile = path.join(tempStackRoot, 'litellm/config.yaml');

    fs.mkdirSync(path.dirname(repoFile), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });

    fs.writeFileSync(repoFile, 'model_list:\n  - model_name: old\n', 'utf8');
    fs.writeFileSync(runtimeFile, 'model_list:\n  - model_name: imported\n', 'utf8');

    const res = runScript(importcfgPath, ['litellm'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Surface: litellm');
    expect(res.stdout).toContain('Mode: pull');
    expect(res.stdout).toContain('Status: ok');

    const updatedRepo = fs.readFileSync(repoFile, 'utf8');
    expect(updatedRepo).toContain('imported');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('importcfg backend is blocked (no runtime-to-repo import path)', () => {
    const res = runScript(importcfgPath, ['backend']);
    expect(res.code).toBe(4);
    expect(res.stdout).toContain('Surface: backend');
    expect(res.stdout).toContain('Mode: pull');
    expect(res.stdout).toContain('Status: blocked');
    expect(res.stdout).toContain('pull mode is not supported');
  });

  test('importcfg cloudflared pull is non-blocking in token mode when runtime config is missing', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();
    const repoCloudflared = path.join(tempRepoRoot, 'ops/stack/cloudflared/config.yml');
    const composeFile = path.join(tempStackRoot, 'docker-compose.yml');

    fs.mkdirSync(path.dirname(repoCloudflared), { recursive: true });
    fs.mkdirSync(path.dirname(composeFile), { recursive: true });

    fs.writeFileSync(repoCloudflared, 'ingress:\n  - service: existing\n', 'utf8');
    fs.writeFileSync(
      composeFile,
      [
        'services:',
        '  cloudflared:',
        '    image: cloudflare/cloudflared:latest',
        '    command: tunnel --no-autoupdate run --token ${CLOUDFLARED_TOKEN}',
        '',
      ].join('\n'),
      'utf8',
    );

    const res = runScript(importcfgPath, ['cloudflared'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Surface: cloudflared');
    expect(res.stdout).toContain('Mode: pull');
    expect(res.stdout).toContain('Status: ok');
    expect(res.stdout).toContain('detected token-based tunnel mode in compose; nothing to import');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('bootstrapcfg imports selected surfaces via importcfg', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();

    const repoLitellm = path.join(tempRepoRoot, 'ops/stack/litellm/config.yaml');
    const runtimeLitellm = path.join(tempStackRoot, 'litellm/config.yaml');
    const repoCloudflared = path.join(tempRepoRoot, 'ops/stack/cloudflared/config.yml');
    const runtimeCloudflared = path.join(tempStackRoot, 'cloudflared/config.yml');

    fs.mkdirSync(path.dirname(repoLitellm), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeLitellm), { recursive: true });
    fs.mkdirSync(path.dirname(repoCloudflared), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeCloudflared), { recursive: true });

    fs.writeFileSync(repoLitellm, 'model_list:\n  - model_name: old\n', 'utf8');
    fs.writeFileSync(runtimeLitellm, 'model_list:\n  - model_name: imported_litellm\n', 'utf8');
    fs.writeFileSync(repoCloudflared, 'ingress:\n  - service: old\n', 'utf8');
    fs.writeFileSync(runtimeCloudflared, 'ingress:\n  - service: imported_cloudflared\n', 'utf8');

    const res = runScript(
      bootstrapcfgPath,
      ['--surface', 'litellm', '--surface', 'cloudflared'],
      {
        CFG_REPO_ROOT: tempRepoRoot,
        CFG_STACK_ROOT: tempStackRoot,
      },
    );

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('[1/2] importcfg litellm');
    expect(res.stdout).toContain('[2/2] importcfg cloudflared');
    expect(res.stdout).toContain('Bootstrap import complete.');

    const litellmRepo = fs.readFileSync(repoLitellm, 'utf8');
    const cloudflaredRepo = fs.readFileSync(repoCloudflared, 'utf8');
    expect(litellmRepo).toContain('imported_litellm');
    expect(cloudflaredRepo).toContain('imported_cloudflared');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('bootstrapcfg default run includes n8n import', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();

    const repoEnvDir = path.join(tempRepoRoot, 'ops/stack/env');
    const repoCompose = path.join(tempRepoRoot, 'ops/stack/docker-compose.yml');
    const repoLitellm = path.join(tempRepoRoot, 'ops/stack/litellm/config.yaml');
    const repoPostgresInit = path.join(tempRepoRoot, 'ops/stack/postgres/init');

    const runtimeCompose = path.join(tempStackRoot, 'docker-compose.yml');
    const runtimeLitellm = path.join(tempStackRoot, 'litellm/config.yaml');
    const runtimePostgresInit = path.join(tempStackRoot, 'postgres-init');
    const fakeN8nSyncPath = path.join(tempRoot, 'sync_workflows.sh');
    const fakeN8nSyncLog = path.join(tempRoot, 'n8n-sync.log');

    fs.mkdirSync(repoEnvDir, { recursive: true });
    fs.mkdirSync(path.dirname(runtimeCompose), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeLitellm), { recursive: true });
    fs.mkdirSync(runtimePostgresInit, { recursive: true });

    fs.writeFileSync(
      runtimeCompose,
      [
        'services:',
        '  cloudflared:',
        '    image: cloudflare/cloudflared:latest',
        '    command: tunnel --no-autoupdate run --token ${CLOUDFLARED_TOKEN}',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(runtimeLitellm, 'model_list:\n  - model_name: imported_default\n', 'utf8');
    fs.writeFileSync(path.join(runtimePostgresInit, '01-create-databases.sql'), '-- imported\n', 'utf8');
    fs.writeFileSync(
      fakeN8nSyncPath,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo "$*" >> "$FAKE_N8N_SYNC_LOG"',
      ].join('\n'),
      'utf8',
    );
    fs.chmodSync(fakeN8nSyncPath, 0o755);

    const res = runScript(bootstrapcfgPath, [], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
      CFG_N8N_SYNC_SCRIPT: fakeN8nSyncPath,
      FAKE_N8N_SYNC_LOG: fakeN8nSyncLog,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('[1/5] importcfg docker');
    expect(res.stdout).toContain('[2/5] importcfg litellm');
    expect(res.stdout).toContain('[3/5] importcfg postgres');
    expect(res.stdout).toContain('[4/5] importcfg cloudflared');
    expect(res.stdout).toContain('[5/5] importcfg n8n');
    expect(res.stdout).toContain('Bootstrap import complete.');

    expect(fs.readFileSync(repoCompose, 'utf8')).toContain('cloudflared');
    expect(fs.readFileSync(repoLitellm, 'utf8')).toContain('imported_default');
    expect(fs.readFileSync(path.join(repoPostgresInit, '01-create-databases.sql'), 'utf8')).toContain('-- imported');
    expect(fs.readFileSync(fakeN8nSyncLog, 'utf8')).toContain('--mode pull');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('bootstrapcfg --skip-n8n runs default non-n8n bootstrap set', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();

    const repoEnvDir = path.join(tempRepoRoot, 'ops/stack/env');
    const repoCompose = path.join(tempRepoRoot, 'ops/stack/docker-compose.yml');
    const repoLitellm = path.join(tempRepoRoot, 'ops/stack/litellm/config.yaml');
    const repoPostgresInit = path.join(tempRepoRoot, 'ops/stack/postgres/init');

    const runtimeCompose = path.join(tempStackRoot, 'docker-compose.yml');
    const runtimeLitellm = path.join(tempStackRoot, 'litellm/config.yaml');
    const runtimePostgresInit = path.join(tempStackRoot, 'postgres-init');

    fs.mkdirSync(repoEnvDir, { recursive: true });
    fs.mkdirSync(path.dirname(runtimeCompose), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeLitellm), { recursive: true });
    fs.mkdirSync(runtimePostgresInit, { recursive: true });

    fs.writeFileSync(
      runtimeCompose,
      [
        'services:',
        '  cloudflared:',
        '    image: cloudflare/cloudflared:latest',
        '    command: tunnel --no-autoupdate run --token ${CLOUDFLARED_TOKEN}',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(runtimeLitellm, 'model_list:\n  - model_name: imported_default\n', 'utf8');
    fs.writeFileSync(path.join(runtimePostgresInit, '01-create-databases.sql'), '-- imported\n', 'utf8');

    const res = runScript(bootstrapcfgPath, ['--skip-n8n'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('[1/4] importcfg docker');
    expect(res.stdout).toContain('[2/4] importcfg litellm');
    expect(res.stdout).toContain('[3/4] importcfg postgres');
    expect(res.stdout).toContain('[4/4] importcfg cloudflared');
    expect(res.stdout).not.toContain('importcfg n8n');
    expect(res.stdout).toContain('Bootstrap import complete.');

    expect(fs.readFileSync(repoCompose, 'utf8')).toContain('cloudflared');
    expect(fs.readFileSync(repoLitellm, 'utf8')).toContain('imported_default');
    expect(fs.readFileSync(path.join(repoPostgresInit, '01-create-databases.sql'), 'utf8')).toContain('-- imported');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('checkcfg backend reports readiness when deploy script exists', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();

    const deployScript = path.join(tempRepoRoot, 'scripts/cfg/backend_push.sh');
    const configJs = path.join(tempRepoRoot, 'src/libs/config.js');
    const serverDir = path.join(tempRepoRoot, 'src/server');
    const configDir = path.join(tempRepoRoot, 'src/libs/config');

    fs.mkdirSync(path.dirname(deployScript), { recursive: true });
    fs.mkdirSync(path.dirname(configJs), { recursive: true });
    fs.mkdirSync(serverDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    fs.writeFileSync(deployScript, '#!/usr/bin/env bash\necho ok\n', 'utf8');
    fs.chmodSync(deployScript, 0o755);
    fs.writeFileSync(configJs, "'use strict';\nmodule.exports = {};\n", 'utf8');

    const res = runScript(checkcfgPath, ['backend'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Surface: backend');
    expect(res.stdout).toContain('Status: clean');
    expect(res.stdout).toContain('deploy script present and executable');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('updatecfg docker push skips compose apply when nothing changed', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();

    const repoCompose = path.join(tempRepoRoot, 'ops/stack/docker-compose.yml');
    const runtimeCompose = path.join(tempStackRoot, 'docker-compose.yml');
    const repoEnvDir = path.join(tempRepoRoot, 'ops/stack/env');
    const repoEnv = path.join(repoEnvDir, 'pkm-server.env');
    const runtimeEnv = path.join(tempStackRoot, 'pkm-server.env');

    fs.mkdirSync(path.dirname(repoCompose), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeCompose), { recursive: true });
    fs.mkdirSync(repoEnvDir, { recursive: true });

    const composePayload = [
      'services:',
      '  pkm-server:',
      '    image: example/pkm-server',
      '',
    ].join('\n');
    const envPayload = 'PKM_FEATURE_X=false\n';

    fs.writeFileSync(repoCompose, composePayload, 'utf8');
    fs.writeFileSync(runtimeCompose, composePayload, 'utf8');
    fs.writeFileSync(repoEnv, envPayload, 'utf8');
    fs.writeFileSync(runtimeEnv, envPayload, 'utf8');

    const fakeDocker = setupFakeDocker(tempRoot);
    const res = runScript(updatecfgPath, ['docker', '--push'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
      ...fakeDocker.dockerEnv,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Surface: docker');
    expect(res.stdout).toContain('Mode: push');
    expect(res.stdout).toContain('no managed docker file changes detected; skipped compose apply');

    const dockerLog = fs.existsSync(fakeDocker.dockerLogPath)
      ? fs.readFileSync(fakeDocker.dockerLogPath, 'utf8')
      : '';
    expect(dockerLog.trim()).toBe('');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('updatecfg docker push targets service when only service env changed', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();

    const repoCompose = path.join(tempRepoRoot, 'ops/stack/docker-compose.yml');
    const runtimeCompose = path.join(tempStackRoot, 'docker-compose.yml');
    const repoEnvDir = path.join(tempRepoRoot, 'ops/stack/env');
    const repoEnv = path.join(repoEnvDir, 'pkm-server.env');
    const runtimeEnv = path.join(tempStackRoot, 'pkm-server.env');

    fs.mkdirSync(path.dirname(repoCompose), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeCompose), { recursive: true });
    fs.mkdirSync(repoEnvDir, { recursive: true });

    const composePayload = [
      'services:',
      '  pkm-server:',
      '    image: example/pkm-server',
      '  n8n:',
      '    image: example/n8n',
      '',
    ].join('\n');

    fs.writeFileSync(repoCompose, composePayload, 'utf8');
    fs.writeFileSync(runtimeCompose, composePayload, 'utf8');
    fs.writeFileSync(repoEnv, 'PKM_FEATURE_X=true\n', 'utf8');
    fs.writeFileSync(runtimeEnv, 'PKM_FEATURE_X=false\n', 'utf8');

    const fakeDocker = setupFakeDocker(tempRoot, 'pkm-server\nn8n\n');
    const res = runScript(updatecfgPath, ['docker', '--push'], {
      CFG_REPO_ROOT: tempRepoRoot,
      CFG_STACK_ROOT: tempStackRoot,
      ...fakeDocker.dockerEnv,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Surface: docker');
    expect(res.stdout).toContain('Mode: push');
    expect(res.stdout).toContain('docker compose targeted apply: pkm-server');
    expect(res.stdout).toContain('scope reason: service env files changed: pkm-server');

    const dockerLog = fs.readFileSync(fakeDocker.dockerLogPath, 'utf8');
    expect(dockerLog).toContain('config --services');
    expect(dockerLog).toContain('up -d pkm-server');
    expect(dockerLog).not.toContain(' up -d\n');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
