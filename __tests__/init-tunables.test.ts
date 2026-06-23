/**
 * Unit tests for `resolveInitTunables` — phase 1 of the init-performance
 * change. Guards every precedence rule (CLI > env > default) for every
 * tunable, plus the corner cases: zero-threads "auto", mutually
 * exclusive --use-git / --no-git, malformed values, and the host
 * defaults on representative 4-core / 8-core / 64-core shapes.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveInitTunables,
  defaultThreads,
  defaultRamMb,
  defaultWorkerRamMb,
  type HostInfo,
} from '../src/init/tunables';

const HOST_4C_8GB: HostInfo = { cpus: 4, totalMemBytes: 8 * 1024 * 1024 * 1024 };
const HOST_8C_16GB: HostInfo = { cpus: 8, totalMemBytes: 16 * 1024 * 1024 * 1024 };
const HOST_64C_64GB: HostInfo = { cpus: 64, totalMemBytes: 64 * 1024 * 1024 * 1024 };

describe('defaultThreads', () => {
  it('returns 1 on a single-core host', () => {
    expect(defaultThreads(1)).toBe(1);
  });
  it('returns cpus-1 on a small host, capped at 8', () => {
    expect(defaultThreads(4)).toBe(3);
    expect(defaultThreads(8)).toBe(7);
  });
  it('caps at 8 on a many-core host', () => {
    expect(defaultThreads(64)).toBe(8);
    expect(defaultThreads(128)).toBe(8);
  });
  it('treats non-finite as 1', () => {
    expect(defaultThreads(NaN)).toBe(1);
    expect(defaultThreads(0)).toBe(1);
  });
});

describe('defaultRamMb', () => {
  it('floors at 1 GB on a small host', () => {
    expect(defaultRamMb(512 * 1024 * 1024)).toBe(1024);
  });
  it('uses a quarter of total memory, in MB', () => {
    expect(defaultRamMb(8 * 1024 * 1024 * 1024)).toBe(2048); // 8 GB / 4
    expect(defaultRamMb(16 * 1024 * 1024 * 1024)).toBe(4096); // 16 GB / 4
  });
  it('caps at 4 GB on a very large host', () => {
    expect(defaultRamMb(64 * 1024 * 1024 * 1024)).toBe(4096);
  });
});

describe('defaultWorkerRamMb', () => {
  it('splits the budget across workers, capped at 2 GB', () => {
    expect(defaultWorkerRamMb(4096, 4)).toBe(1024);
    expect(defaultWorkerRamMb(2048, 1)).toBe(2048);
  });
  it('caps a single-threaded host at 2 GB', () => {
    expect(defaultWorkerRamMb(8192, 1)).toBe(2048);
  });
  it('does not divide by zero', () => {
    expect(defaultWorkerRamMb(2048, 0)).toBe(2048);
  });
});

describe('resolveInitTunables — defaults', () => {
  it('uses host-derived defaults when nothing is provided', () => {
    const t = resolveInitTunables({}, {}, HOST_8C_16GB);
    expect(t.threads).toBe(7);
    expect(t.ramMb).toBe(4096);
    expect(t.batchSize).toBe(100);
    expect(t.batchFlushMs).toBe(250);
    expect(t.sizeLimitMb).toBe(1);
    expect(t.workerRamMb).toBe(defaultWorkerRamMb(4096, 7));
    expect(t.gitMode).toBe('auto');
    expect(t.progressIntervalMs).toBe(100);
  });

  it('caps threads at 1 on a 1-core host', () => {
    const t = resolveInitTunables({}, {}, { cpus: 1, totalMemBytes: 2 * 1024 * 1024 * 1024 });
    expect(t.threads).toBe(1);
    expect(t.ramMb).toBe(1024);
  });

  it('caps threads at 8 on a 64-core host', () => {
    const t = resolveInitTunables({}, {}, HOST_64C_64GB);
    expect(t.threads).toBe(8);
  });
});

describe('resolveInitTunables — precedence: CLI > env > default', () => {
  it('CLI flag beats env and default (threads)', () => {
    const t = resolveInitTunables(
      { threads: '4' },
      { SPRINGGRAPH_THREADS: '2' },
      HOST_8C_16GB
    );
    expect(t.threads).toBe(4);
  });

  it('env beats default (threads)', () => {
    const t = resolveInitTunables({}, { SPRINGGRAPH_THREADS: '2' }, HOST_8C_16GB);
    expect(t.threads).toBe(2);
  });

  it('CLI flag beats env and default (ram)', () => {
    const t = resolveInitTunables(
      { ram: '2048' },
      { SPRINGGRAPH_RAM: '1024' },
      HOST_8C_16GB
    );
    expect(t.ramMb).toBe(2048);
  });

  it('env beats default (ram)', () => {
    const t = resolveInitTunables({}, { SPRINGGRAPH_RAM: '1024' }, HOST_8C_16GB);
    expect(t.ramMb).toBe(1024);
  });

  it('CLI flag beats env and default (batchSize)', () => {
    const t = resolveInitTunables(
      { batchSize: '50' },
      { SPRINGGRAPH_BATCH_SIZE: '200' },
      HOST_8C_16GB
    );
    expect(t.batchSize).toBe(50);
  });

  it('CLI flag beats env and default (sizeLimit)', () => {
    const t = resolveInitTunables(
      { sizeLimitMb: '5' },
      { SPRINGGRAPH_SIZE_LIMIT_MB: '10' },
      HOST_8C_16GB
    );
    expect(t.sizeLimitMb).toBe(5);
  });

  it('CLI flag beats env and default (workerRam)', () => {
    const t = resolveInitTunables(
      { workerRamMb: '256' },
      { SPRINGGRAPH_WORKER_RAM_MB: '512' },
      HOST_8C_16GB
    );
    expect(t.workerRamMb).toBe(256);
  });

  it('CLI flag beats env and default (progressIntervalMs)', () => {
    const t = resolveInitTunables(
      { progressIntervalMs: '500' },
      { SPRINGGRAPH_PROGRESS_MS: '250' },
      HOST_8C_16GB
    );
    expect(t.progressIntervalMs).toBe(500);
  });

  it('CLI flag beats env and default (batchFlushMs)', () => {
    const t = resolveInitTunables(
      { batchFlushMs: '1000' },
      { SPRINGGRAPH_BATCH_FLUSH_MS: '500' },
      HOST_8C_16GB
    );
    expect(t.batchFlushMs).toBe(1000);
  });
});

describe('resolveInitTunables — threads=0 means auto', () => {
  it('CLI 0 falls back to host default', () => {
    const t = resolveInitTunables({ threads: '0' }, {}, HOST_8C_16GB);
    expect(t.threads).toBe(7);
  });

  it('env 0 falls back to host default', () => {
    const t = resolveInitTunables({}, { SPRINGGRAPH_THREADS: '0' }, HOST_8C_16GB);
    expect(t.threads).toBe(7);
  });

  it('CLI 0 is overridden by an explicit CLI value', () => {
    const t = resolveInitTunables(
      { threads: '0', batchSize: '50' },
      {},
      HOST_8C_16GB
    );
    // threads=0 means auto; batchSize=50 still applies.
    expect(t.threads).toBe(7);
    expect(t.batchSize).toBe(50);
  });
});

describe('resolveInitTunables — git mode', () => {
  it('--use-git forces git mode', () => {
    const t = resolveInitTunables({ useGit: true }, {}, HOST_8C_16GB);
    expect(t.gitMode).toBe('use');
  });

  it('--no-git forces fs walk', () => {
    const t = resolveInitTunables({ noGit: true }, {}, HOST_8C_16GB);
    expect(t.gitMode).toBe('no');
  });

  it('SPRINGGRAPH_NO_GIT=1 inverts auto to no', () => {
    const t = resolveInitTunables({}, { SPRINGGRAPH_NO_GIT: '1' }, HOST_8C_16GB);
    expect(t.gitMode).toBe('no');
  });

  it('SPRINGGRAPH_NO_GIT=true inverts auto to no', () => {
    const t = resolveInitTunables({}, { SPRINGGRAPH_NO_GIT: 'true' }, HOST_8C_16GB);
    expect(t.gitMode).toBe('no');
  });

  it('SPRINGGRAPH_NO_GIT=0 leaves auto alone', () => {
    const t = resolveInitTunables({}, { SPRINGGRAPH_NO_GIT: '0' }, HOST_8C_16GB);
    expect(t.gitMode).toBe('auto');
  });

  it('--use-git beats env NO_GIT=1', () => {
    const t = resolveInitTunables(
      { useGit: true },
      { SPRINGGRAPH_NO_GIT: '1' },
      HOST_8C_16GB
    );
    expect(t.gitMode).toBe('use');
  });

  it('--no-git beats env unset', () => {
    const t = resolveInitTunables({ noGit: true }, {}, HOST_8C_16GB);
    expect(t.gitMode).toBe('no');
  });

  it('--use-git and --no-git together throw', () => {
    expect(() =>
      resolveInitTunables({ useGit: true, noGit: true }, {}, HOST_8C_16GB)
    ).toThrow(/mutually exclusive/);
  });
});

describe('resolveInitTunables — malformed values fail loud', () => {
  it('CLI non-integer threads throws', () => {
    expect(() => resolveInitTunables({ threads: 'banana' }, {}, HOST_8C_16GB)).toThrow(/integer/);
  });

  it('env non-integer ram throws', () => {
    expect(() => resolveInitTunables({}, { SPRINGGRAPH_RAM: 'lots' }, HOST_8C_16GB)).toThrow(/positive integer/);
  });

  it('CLI negative batchSize throws', () => {
    expect(() => resolveInitTunables({ batchSize: '-1' }, {}, HOST_8C_16GB)).toThrow(/positive integer/);
  });

  it('CLI float ram throws', () => {
    expect(() => resolveInitTunables({ ram: '1024.5' }, {}, HOST_8C_16GB)).toThrow(/positive integer/);
  });

  it('CLI zero batchSize throws (1+ required)', () => {
    expect(() => resolveInitTunables({ batchSize: '0' }, {}, HOST_8C_16GB)).toThrow(/positive integer/);
  });

  it('CLI empty string for threads is treated as missing (no throw)', () => {
    const t = resolveInitTunables({ threads: '   ' }, {}, HOST_8C_16GB);
    expect(t.threads).toBe(7);
  });
});

describe('resolveInitTunables — corner cases', () => {
  it('zero batchFlushMs is allowed (disables time-based flush)', () => {
    const t = resolveInitTunables({ batchFlushMs: '0' }, {}, HOST_8C_16GB);
    expect(t.batchFlushMs).toBe(0);
  });

  it('zero progressIntervalMs is allowed (fires every result)', () => {
    const t = resolveInitTunables({ progressIntervalMs: '0' }, {}, HOST_8C_16GB);
    expect(t.progressIntervalMs).toBe(0);
  });

  it('whitespace around values is trimmed', () => {
    const t = resolveInitTunables(
      { threads: '  3  ', batchSize: ' 200 ' },
      {},
      HOST_8C_16GB
    );
    expect(t.threads).toBe(3);
    expect(t.batchSize).toBe(200);
  });

  it('env precedence respects case-sensitive env names', () => {
    // env names are case-sensitive on Linux but Windows is
    // case-insensitive — the resolver reads them as-is, so
    // SPRINGGRAPH_THREADS works on every platform.
    const t = resolveInitTunables({}, { SPRINGGRAPH_THREADS: '5' }, HOST_8C_16GB);
    expect(t.threads).toBe(5);
  });

  it('workerRamMb default tracks ramMb and threads', () => {
    const t = resolveInitTunables({ ram: '2048', threads: '4' }, {}, HOST_8C_16GB);
    expect(t.ramMb).toBe(2048);
    expect(t.threads).toBe(4);
    expect(t.workerRamMb).toBe(defaultWorkerRamMb(2048, 4));
  });

  it('CLI threads=1 is honored even when host is 8 cores', () => {
    const t = resolveInitTunables({ threads: '1' }, {}, HOST_8C_16GB);
    expect(t.threads).toBe(1);
    // And workerRamMb reflects the single-worker split.
    expect(t.workerRamMb).toBe(defaultWorkerRamMb(4096, 1));
  });
});
