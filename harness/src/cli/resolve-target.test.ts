import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePcfTarget, ResolveTargetError } from './resolve-target';

const MANIFEST = '<?xml version="1.0" encoding="utf-8"?><manifest/>';

function mkdir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}
function writeManifest(dir: string): void {
  mkdir(dir);
  fs.writeFileSync(path.join(dir, 'ControlManifest.Input.xml'), MANIFEST);
}
function writeDeployedManifest(dir: string): void {
  mkdir(dir);
  fs.writeFileSync(path.join(dir, 'ControlManifest.xml'), MANIFEST);
}

describe('resolvePcfTarget', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcfwb-resolve-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns control mode when ControlManifest.Input.xml is in the given dir', () => {
    const ctrl = path.join(tmp, 'MyControl');
    writeManifest(ctrl);

    const result = resolvePcfTarget(ctrl);
    expect(result.kind).toBe('control');
    expect(result.path).toBe(path.resolve(ctrl));
  });

  it('returns workspace mode when subdirs contain manifests (one level deep)', () => {
    writeManifest(path.join(tmp, 'ControlA'));
    writeManifest(path.join(tmp, 'ControlB'));
    mkdir(path.join(tmp, 'docs'));

    const result = resolvePcfTarget(tmp);
    expect(result.kind).toBe('workspace');
    if (result.kind === 'workspace') {
      expect(result.controls.sort()).toEqual(['ControlA', 'ControlB']);
    }
  });

  it('returns workspace mode for PCF projects (manifest two levels deep)', () => {
    // pac pcf init layout: <workspace>/<Project>/<ControlName>/manifest
    writeManifest(path.join(tmp, 'ProjectA', 'ControlA'));
    writeManifest(path.join(tmp, 'ProjectB', 'ControlB'));

    const result = resolvePcfTarget(tmp);
    expect(result.kind).toBe('workspace');
    if (result.kind === 'workspace') {
      expect(result.controls.sort()).toEqual(['ProjectA', 'ProjectB']);
    }
  });

  it('skips node_modules / out / obj / bin / generated when scanning subdirs', () => {
    writeManifest(path.join(tmp, 'RealControl'));
    writeManifest(path.join(tmp, 'node_modules', 'FakeControl'));
    writeManifest(path.join(tmp, 'out', 'FakeControl'));
    writeManifest(path.join(tmp, 'obj', 'FakeControl'));

    const result = resolvePcfTarget(tmp);
    expect(result.kind).toBe('workspace');
    if (result.kind === 'workspace') {
      expect(result.controls).toEqual(['RealControl']);
    }
  });

  it('skips dotfile directories', () => {
    writeManifest(path.join(tmp, 'RealControl'));
    writeManifest(path.join(tmp, '.cache', 'FakeControl'));

    const result = resolvePcfTarget(tmp);
    expect(result.kind).toBe('workspace');
    if (result.kind === 'workspace') {
      expect(result.controls).toEqual(['RealControl']);
    }
  });

  it('throws ResolveTargetError when path does not exist', () => {
    expect(() => resolvePcfTarget(path.join(tmp, 'nope'))).toThrow(ResolveTargetError);
  });

  it('throws when path is a file, not a directory', () => {
    const file = path.join(tmp, 'a.txt');
    fs.writeFileSync(file, 'x');
    expect(() => resolvePcfTarget(file)).toThrow(/not a directory/);
  });

  it('throws when dir has neither a manifest nor sub-control manifests', () => {
    mkdir(path.join(tmp, 'empty-subdir'));
    fs.writeFileSync(path.join(tmp, 'README.md'), '# nope');
    expect(() => resolvePcfTarget(tmp)).toThrow(/No PCF control found/);
  });

  it('error message lists directory contents for debugging', () => {
    mkdir(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');

    try {
      resolvePcfTarget(tmp);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ResolveTargetError);
      expect(e.message).toMatch(/src\//);
      expect(e.message).toMatch(/package\.json/);
    }
  });

  it('control mode wins when both a direct manifest AND sub-control manifests exist', () => {
    writeManifest(tmp);
    writeManifest(path.join(tmp, 'SubControl'));
    const result = resolvePcfTarget(tmp);
    expect(result.kind).toBe('control');
  });

  it('returns control mode for deployed/extracted controls (ControlManifest.xml)', () => {
    const ctrl = path.join(tmp, 'DeployedControl');
    writeDeployedManifest(ctrl);
    const result = resolvePcfTarget(ctrl);
    expect(result.kind).toBe('control');
    expect(result.path).toBe(path.resolve(ctrl));
  });

  it('workspace mode picks up both source and deployed manifests in subdirs', () => {
    writeManifest(path.join(tmp, 'SourceControl'));
    writeDeployedManifest(path.join(tmp, 'DeployedControl'));
    const result = resolvePcfTarget(tmp);
    expect(result.kind).toBe('workspace');
    if (result.kind === 'workspace') {
      expect(result.controls.sort()).toEqual(['DeployedControl', 'SourceControl']);
    }
  });
});
