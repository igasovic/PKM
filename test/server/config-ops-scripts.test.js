'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const checkcfgPath = path.join(repoRoot, 'scripts/cfg/checkcfg');
const updatecfgPath = path.join(repoRoot, 'scripts/cfg/updatecfg');

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

  test('checkcfg backend reports readiness when deploy script exists', () => {
    const { tempRoot, tempRepoRoot, tempStackRoot } = makeTempRoots();

    const deployScript = path.join(tempRepoRoot, 'scripts/redeploy');
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
});
