/**
 * The two things the challenger ads script keeps on the machine it runs on, both outside git:
 * a single-run lock file and one JSON manifest per run.
 *
 * The spec asked for an Upstash Redis lock, but the app no longer has a Redis client or Redis
 * settings (rate limiting moved into the database). The script runs only from the owner's Mac,
 * so the lock is a file on that Mac instead, behind the same ChallengerLock interface. It
 * guards against a second run started on the same machine, which is the case that matters; it
 * does not coordinate two different machines.
 */
import { link, mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChallengerLock, ChallengerLockResult, ChallengerManifest } from '@/lib/campaigns/challenger-ads';

/** A lock older than this is treated as left behind by a run that died (the spec's EX 1800). */
export const LOCK_STALE_AFTER_MS = 30 * 60 * 1000;
export const LOCK_FILE_NAME = 'add-weekday-challenger-ads.lock';

/** Under the user's home directory, so it can never be committed. */
export function defaultStateDirectory(): string {
  return path.join(os.homedir(), '.cheersai', 'weekday-challenger-ads');
}

/**
 * Where the lock and the manifests go. A chosen directory must sit outside the repository, so
 * a manifest cannot be committed by accident.
 */
export function resolveStateDirectory(chosen: string | null | undefined, repositoryRoot: string): string {
  if (!chosen?.trim()) return defaultStateDirectory();

  const directory = path.resolve(chosen.trim());
  const root = path.resolve(repositoryRoot);
  if (directory === root || directory.startsWith(`${root}${path.sep}`)) {
    throw new Error(`--state-dir must be outside the repository (${root}), so the manifest and lock stay out of git.`);
  }
  return directory;
}

interface HeldLock {
  runId: string;
  acquiredAt: Date;
  /** The file's exact text, to tell whether the lock changed hands. */
  raw: string;
}

export function createFileRunLock(options: {
  directory: string;
  now?: () => Date;
  staleAfterMs?: number;
}): ChallengerLock {
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? LOCK_STALE_AFTER_MS;
  const lockPath = path.join(options.directory, LOCK_FILE_NAME);

  /** Creates the lock only if no file is there: two runs cannot both succeed. */
  async function tryCreate(runId: string): Promise<'created' | 'exists' | Error> {
    let handle;
    try {
      handle = await open(lockPath, 'wx');
    } catch (error) {
      if (isErrno(error, 'EEXIST')) return 'exists';
      return toError(error);
    }
    try {
      await handle.writeFile(JSON.stringify({ runId, acquiredAt: now().toISOString() }));
    } finally {
      await handle.close();
    }
    return 'created';
  }

  async function readLock(file: string): Promise<HeldLock | null> {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null;
      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as { runId?: unknown; acquiredAt?: unknown };
      const acquiredAt = typeof parsed.acquiredAt === 'string' ? new Date(parsed.acquiredAt) : null;
      if (typeof parsed.runId === 'string' && parsed.runId && acquiredAt && !Number.isNaN(acquiredAt.getTime())) {
        return { runId: parsed.runId, acquiredAt, raw };
      }
    } catch {
      // Not readable as a lock: fall through and age it by when the file was last written.
    }
    const { mtime } = await stat(file);
    return { runId: 'unknown', acquiredAt: mtime, raw };
  }

  async function acquire(runId: string): Promise<ChallengerLockResult> {
    try {
      await mkdir(options.directory, { recursive: true });

      const first = await tryCreate(runId);
      if (first === 'created') return { acquired: true };
      if (first !== 'exists') return unusable(first);

      const held = await readLock(lockPath);
      if (!held) {
        // Released between the two calls: one more exclusive attempt.
        const second = await tryCreate(runId);
        if (second === 'created') return { acquired: true };
        return second === 'exists' ? busy('another run took the lock first') : unusable(second);
      }

      const ageMs = now().getTime() - held.acquiredAt.getTime();
      if (ageMs < staleAfterMs) {
        return busy(`run ${held.runId} has held it since ${held.acquiredAt.toISOString()}`);
      }

      // Stale: take it over. A hard link named after the stale run is made first. Making it
      // fails if another process has already taken this stale lock over, so only one can.
      const tombstone = `${lockPath}.stale-${held.runId.replace(/[^A-Za-z0-9_-]/g, '_')}-${held.acquiredAt.getTime()}`;
      try {
        await link(lockPath, tombstone);
      } catch (error) {
        if (isErrno(error, 'EEXIST') || isErrno(error, 'ENOENT')) return busy('another run is taking over the stale lock');
        return unusable(toError(error));
      }
      // The link must be to the stale lock that was read, not to a fresh one made in between.
      const linked = await readLock(tombstone);
      if (!linked || linked.raw !== held.raw) {
        await unlink(tombstone).catch(() => undefined);
        return busy('the lock changed hands while it was being checked');
      }
      await unlink(lockPath).catch(() => undefined);

      const third = await tryCreate(runId);
      if (third === 'created') return { acquired: true };
      return third === 'exists' ? busy('another run took the lock first') : unusable(third);
    } catch (error) {
      return unusable(toError(error));
    }
  }

  /** Releases the lock only if it still holds this run's id. */
  async function release(runId: string): Promise<void> {
    const held = await readLock(lockPath);
    if (!held || held.runId !== runId) return;
    await unlink(lockPath);
  }

  function busy(detail: string): ChallengerLockResult {
    return {
      acquired: false,
      reason: `another run holds the single-run lock (${detail}). A lock clears itself 30 minutes after it was taken; the file is ${lockPath}.`,
    };
  }

  function unusable(error: Error): ChallengerLockResult {
    return {
      acquired: false,
      reason: `the lock location ${options.directory} cannot be used (${error.message}), so the run cannot be made safe.`,
    };
  }

  return { acquire, release };
}

/** Saves each run's manifest as its own JSON file, readable only by the owner. */
export function createManifestWriter(directory: string): (manifest: ChallengerManifest) => Promise<string> {
  return async (manifest) => {
    const folder = path.join(directory, 'manifests');
    await mkdir(folder, { recursive: true });
    const name = `${manifest.runId.replace(/[^A-Za-z0-9_-]/g, '_')}-${manifest.mode}.json`;
    const file = path.join(folder, name);
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    return file;
  };
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
