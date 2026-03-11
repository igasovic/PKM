'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const checkcfgPath = path.join(repoRoot, 'scripts/cfg/checkcfg');
const updatecfgPath = path.join(repoRoot, 'scripts/cfg/updatecfg');
const importcfgPath = path.join(repoRoot, 'scripts/cfg/importcfg');

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
