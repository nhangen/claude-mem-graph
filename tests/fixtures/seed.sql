CREATE TABLE IF NOT EXISTS schema_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO schema_versions (version, created_at) VALUES (24, '2026-04-08T00:00:00.000Z');
INSERT INTO schema_versions (version, created_at) VALUES (26, '2026-04-08T00:00:01.000Z');

CREATE TABLE IF NOT EXISTS sdk_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_session_id TEXT UNIQUE NOT NULL,
  memory_session_id TEXT UNIQUE,
  project TEXT NOT NULL,
  user_prompt TEXT,
  started_at TEXT NOT NULL,
  started_at_epoch INTEGER NOT NULL,
  completed_at TEXT,
  completed_at_epoch INTEGER,
  status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active',
  worker_port INTEGER,
  prompt_counter INTEGER DEFAULT 0,
  custom_title TEXT,
  platform_source TEXT NOT NULL DEFAULT 'claude'
);

INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, completed_at, completed_at_epoch, status)
VALUES ('sess-a', 'mem-a', 'wp-content', '2026-04-01T10:00:00Z', 1743505200000, '2026-04-01T12:00:00Z', 1743512400000, 'completed');
INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, completed_at, completed_at_epoch, status)
VALUES ('sess-b', 'mem-b', 'wp-content', '2026-04-01T14:00:00Z', 1743519600000, '2026-04-01T16:00:00Z', 1743526800000, 'completed');
INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, completed_at, completed_at_epoch, status)
VALUES ('sess-c', 'mem-c', 'public', '2026-04-02T10:00:00Z', 1743591600000, '2026-04-02T11:00:00Z', 1743595200000, 'completed');
INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, completed_at, completed_at_epoch, status)
VALUES ('sess-d', 'mem-d', 'wp-content', '2026-04-03T14:00:00Z', 1743692400000, '2026-04-03T16:00:00Z', 1743699600000, 'completed');

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  text TEXT,
  type TEXT NOT NULL,
  title TEXT,
  subtitle TEXT,
  facts TEXT,
  narrative TEXT,
  concepts TEXT,
  files_read TEXT,
  files_modified TEXT,
  prompt_number INTEGER,
  discovery_tokens INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL,
  content_hash TEXT,
  generated_by_model TEXT,
  relevance_count INTEGER DEFAULT 0
);

INSERT INTO observations (id, memory_session_id, project, type, title, concepts, files_read, files_modified, prompt_number, created_at, created_at_epoch, relevance_count)
VALUES (1, 'mem-a', 'wp-content', 'discovery', 'HubSpot v1 API deprecated',
  '["hubspot","api-migration","contact-lists"]', '["src/HubSpot/Client.php"]', '[]', 1,
  '2026-04-01T10:30:00Z', 1743507000000, 5);

INSERT INTO observations (id, memory_session_id, project, type, title, concepts, files_read, files_modified, prompt_number, created_at, created_at_epoch, relevance_count)
VALUES (2, 'mem-a', 'wp-content', 'decision', 'Migrate to HubSpot v3 lists API',
  '["hubspot","api-migration","contact-lists"]', '["src/HubSpot/Client.php"]', '["src/HubSpot/V3Client.php"]', 2,
  '2026-04-01T11:00:00Z', 1743508800000, 3);

INSERT INTO observations (id, memory_session_id, project, type, title, concepts, files_read, files_modified, prompt_number, created_at, created_at_epoch, relevance_count)
VALUES (3, 'mem-b', 'wp-content', 'feature', 'V3 list resolution with fallback',
  '["hubspot","api-migration","contact-lists","error-handling"]',
  '["src/HubSpot/V3Client.php"]', '["src/HubSpot/V3Client.php","tests/HubSpot/V3ClientTest.php"]', 1,
  '2026-04-01T14:30:00Z', 1743521400000, 2);

INSERT INTO observations (id, memory_session_id, project, type, title, concepts, files_read, files_modified, prompt_number, created_at, created_at_epoch, relevance_count)
VALUES (4, 'mem-b', 'wp-content', 'decision', 'Use batch endpoint instead of single-list resolve',
  '["hubspot","api-migration","contact-lists","batch-api"]',
  '["src/HubSpot/V3Client.php"]', '["src/HubSpot/V3Client.php"]', 3,
  '2026-04-01T15:00:00Z', 1743523200000, 1);

INSERT INTO observations (id, memory_session_id, project, type, title, concepts, files_read, files_modified, prompt_number, created_at, created_at_epoch, relevance_count)
VALUES (5, 'mem-c', 'public', 'discovery', 'Token scope cache analysis',
  '["token-scope","cache","cost-optimization"]', '["src/reports/cache.ts"]', '[]', 1,
  '2026-04-02T10:15:00Z', 1743592500000, 0);

INSERT INTO observations (id, memory_session_id, project, type, title, concepts, files_read, files_modified, prompt_number, created_at, created_at_epoch, relevance_count)
VALUES (6, 'mem-c', 'public', 'bugfix', 'Fix shared test helper import',
  '["testing","imports"]',
  '["tests/HubSpot/V3ClientTest.php"]', '["tests/HubSpot/V3ClientTest.php"]', 2,
  '2026-04-02T10:45:00Z', 1743594300000, 1);

INSERT INTO observations (id, memory_session_id, project, type, title, concepts, files_read, files_modified, prompt_number, created_at, created_at_epoch, relevance_count)
VALUES (7, 'mem-d', 'wp-content', 'discovery', 'Batch API rate limits documented',
  '["hubspot","batch-api","rate-limits"]', '["src/HubSpot/V3Client.php"]', '[]', 1,
  '2026-04-03T14:30:00Z', 1743694200000, 0);
