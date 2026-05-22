import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  selectObservations,
  formatContext,
  detectProjectFromCwd,
  parsePositiveInt,
} from '../src/session-context.js';

function createFixtureDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'cmg-session-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new Database(dbPath);
  const seed = readFileSync(join(__dirname, 'fixtures/seed.sql'), 'utf-8');
  db.exec(seed);
  db.close();
  return new Database(dbPath, { readonly: true });
}

let db: Database.Database;

beforeAll(() => {
  db = createFixtureDb();
});

describe('selectObservations', () => {
  it('returns observations within the recency window', () => {
    const result = selectObservations(db, {
      project: 'wp-content',
      limit: 10,
      windowHours: 999999999,
      now: Date.now(),
    });
    expect(result.totalAvailable).toBeGreaterThan(0);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.windowHit).toBe(true);
  });

  it('falls back to top-N when window is empty', () => {
    const result = selectObservations(db, {
      project: 'wp-content',
      limit: 3,
      windowHours: 1,
      now: Date.now(),
    });
    expect(result.windowHit).toBe(false);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThanOrEqual(3);
  });

  it('caps result count at limit', () => {
    const result = selectObservations(db, {
      project: 'wp-content',
      limit: 2,
      windowHours: 999999999,
      now: Date.now(),
    });
    expect(result.rows.length).toBeLessThanOrEqual(2);
  });

  it('returns empty result for unknown project', () => {
    const result = selectObservations(db, {
      project: 'no-such-project-xyz',
      limit: 10,
      windowHours: 24,
      now: Date.now(),
    });
    expect(result.totalAvailable).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('orders rows by created_at_epoch DESC', () => {
    const result = selectObservations(db, {
      project: 'wp-content',
      limit: 10,
      windowHours: 999999999,
      now: Date.now(),
    });
    for (let i = 1; i < result.rows.length; i++) {
      expect(result.rows[i - 1].created_at_epoch).toBeGreaterThanOrEqual(
        result.rows[i].created_at_epoch
      );
    }
  });
});

describe('formatContext', () => {
  it('emits empty string when no rows', () => {
    expect(formatContext({ rows: [], windowHit: false, totalAvailable: 0 })).toBe('');
  });

  it('labels window-hit results as recent', () => {
    const result = selectObservations(db, {
      project: 'wp-content',
      limit: 5,
      windowHours: 999999999,
      now: Date.now(),
    });
    const out = formatContext(result);
    expect(out).toContain('# claude-mem-graph (recent');
    expect(out).toMatch(/#\d+ \w+:/);
  });

  it('labels fallback results as no recent activity', () => {
    const result = selectObservations(db, {
      project: 'wp-content',
      limit: 3,
      windowHours: 1,
      now: Date.now(),
    });
    const out = formatContext(result);
    expect(out).toContain('no recent activity');
  });

  it('includes a footer pointer when older context remains', () => {
    const result = selectObservations(db, {
      project: 'wp-content',
      limit: 1,
      windowHours: 999999999,
      now: Date.now(),
    });
    const out = formatContext(result);
    if (result.totalAvailable > 1) {
      expect(out).toContain('Older context available');
    }
  });
});

describe('detectProjectFromCwd', () => {
  it('returns the last path segment', () => {
    expect(detectProjectFromCwd('/Users/foo/Local Sites/bar/wp-content')).toBe('wp-content');
  });

  it('handles trailing slash', () => {
    expect(detectProjectFromCwd('/Users/foo/project/')).toBe('project');
  });

  it('returns null for empty or undefined', () => {
    expect(detectProjectFromCwd(undefined)).toBeNull();
    expect(detectProjectFromCwd('')).toBeNull();
  });
});

describe('parsePositiveInt', () => {
  it('returns parsed value when valid', () => {
    expect(parsePositiveInt('42', 10)).toBe(42);
  });

  it('falls back on undefined or invalid', () => {
    expect(parsePositiveInt(undefined, 10)).toBe(10);
    expect(parsePositiveInt('not-a-number', 10)).toBe(10);
    expect(parsePositiveInt('0', 10)).toBe(10);
    expect(parsePositiveInt('-5', 10)).toBe(10);
  });
});
