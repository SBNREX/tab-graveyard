const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, 'graveyard.db'));
const PORT = 3000;
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

app.use(express.json());

db.exec(`
  CREATE TABLE IF NOT EXISTS tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    cause TEXT NOT NULL,
    notes TEXT DEFAULT '',
    buried_at TEXT NOT NULL,
    lifespan_ms INTEGER,
    resurrected_at TEXT
  )
`);

const VALID_CAUSES = [
  'DISTRACTION',
  'PRODUCTIVITY',
  'RESEARCH',
  'PROCRASTINATION',
  'OTHER'
];

function validId(id) {
  return /^\d+$/.test(id) && Number(id) > 0;
}

function getTab(id) {
  return db.prepare('SELECT * FROM tabs WHERE id = ?').get(id);
}

function validateTab(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Body must be a JSON object';
  }

  if (typeof body.title !== 'string' || !body.title.trim()) {
    return 'title must be a non-empty string';
  }

  if (typeof body.url !== 'string') {
    return 'url must be a valid HTTP or HTTPS URL';
  }

  try {
    const parsed = new URL(body.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'url must use HTTP or HTTPS';
    }
  } catch {
    return 'url must be a valid HTTP or HTTPS URL';
  }

  if (!VALID_CAUSES.includes(body.cause)) {
    return `cause must be one of: ${VALID_CAUSES.join(', ')}`;
  }

  if (body.notes !== undefined && typeof body.notes !== 'string') {
    return 'notes must be a string';
  }

  if (
    body.lifespanMs !== undefined &&
    (!Number.isFinite(body.lifespanMs) || body.lifespanMs < 0)
  ) {
    return 'lifespanMs must be a non-negative number';
  }

  return null;
}

function insertTab(tab) {
  const result = db.prepare(`
    INSERT INTO tabs (title, url, cause, notes, buried_at, lifespan_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    tab.title.trim(),
    tab.url,
    tab.cause,
    tab.notes || '',
    new Date().toISOString(),
    tab.lifespanMs ?? null
  );

  return getTab(result.lastInsertRowid);
}

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Tab Graveyard API!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Graveyard API is running' });
});

app.post('/bury', (req, res) => {
  const error = validateTab(req.body);
  if (error) return res.status(400).json({ error });
  res.status(201).json(insertTab(req.body));
});

app.post('/graveyard/bulk-bury', (req, res) => {
  const tabs = req.body?.tabs;

  if (!Array.isArray(tabs) || tabs.length < 1 || tabs.length > 100) {
    return res.status(400).json({
      error: 'Provide a tabs array containing 1 to 100 tabs'
    });
  }

  for (const tab of tabs) {
    const error = validateTab(tab);
    if (error) return res.status(400).json({ error });
  }

  const buryAll = db.transaction(items => items.map(insertTab));
  res.status(201).json({ tabs: buryAll(tabs) });
});

app.get('/graveyard', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const tabs = db.prepare(`
    SELECT * FROM tabs
    WHERE resurrected_at IS NULL
    ORDER BY buried_at DESC
    LIMIT ?
  `).all(limit);

  res.json({ count: tabs.length, tabs });
});

app.get('/graveyard/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT COUNT(*) AS totalBurials,
           AVG(lifespan_ms) AS averageLifespanMs
    FROM tabs
  `).get();

  const common = db.prepare(`
    SELECT cause, COUNT(*) AS count
    FROM tabs
    GROUP BY cause
    ORDER BY count DESC, cause ASC
    LIMIT 1
  `).get();

  res.json({
    totalBurials: stats.totalBurials,
    averageLifespanMs: stats.averageLifespanMs,
    mostCommonCause: common?.cause ?? null,
    mostCommonCauseCount: common?.count ?? 0
  });
});

app.get('/graveyard/leaderboard', (req, res) => {
  const leaderboard = db.prepare(`
    SELECT cause, COUNT(*) AS count
    FROM tabs
    GROUP BY cause
    ORDER BY count DESC, cause ASC
  `).all();

  res.json({ leaderboard });
});

app.get('/graveyard/oldest', (req, res) => {
  const tab = db.prepare(`
    SELECT * FROM tabs
    WHERE resurrected_at IS NULL
    ORDER BY buried_at ASC
    LIMIT 1
  `).get();

  if (!tab) return res.status(404).json({ error: 'No buried tabs found' });
  res.json(tab);
});

app.get('/graveyard/recent', (req, res) => {
  const tabs = db.prepare(`
    SELECT * FROM tabs
    WHERE resurrected_at IS NULL
    ORDER BY buried_at DESC
    LIMIT 10
  `).all();

  res.json({ tabs });
});

app.get('/graveyard/cause/:cause', (req, res) => {
  const cause = req.params.cause.toUpperCase();

  if (!VALID_CAUSES.includes(cause)) {
    return res.status(400).json({ error: 'Invalid cause of death' });
  }

  const tabs = db.prepare(`
    SELECT * FROM tabs
    WHERE cause = ? AND resurrected_at IS NULL
    ORDER BY buried_at DESC
  `).all(cause);

  res.json({ count: tabs.length, tabs });
});

app.get('/graveyard/:id', (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tab ID' });
  }

  const tab = getTab(Number(req.params.id));
  if (!tab) return res.status(404).json({ error: 'Tab not found' });
  res.json(tab);
});

app.patch('/graveyard/:id', (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tab ID' });
  }

  const tab = getTab(Number(req.params.id));
  if (!tab) return res.status(404).json({ error: 'Tab not found' });

  const { cause, notes } = req.body || {};

  if (cause === undefined && notes === undefined) {
    return res.status(400).json({ error: 'Provide cause or notes to update' });
  }

  if (cause !== undefined && !VALID_CAUSES.includes(cause)) {
    return res.status(400).json({ error: 'Invalid cause of death' });
  }

  if (notes !== undefined && typeof notes !== 'string') {
    return res.status(400).json({ error: 'notes must be a string' });
  }

  db.prepare(`
    UPDATE tabs
    SET cause = COALESCE(?, cause),
        notes = COALESCE(?, notes)
    WHERE id = ?
  `).run(cause ?? null, notes ?? null, Number(req.params.id));

  res.json(getTab(Number(req.params.id)));
});

app.post('/resurrect/:id', (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tab ID' });
  }

  const tab = getTab(Number(req.params.id));
  if (!tab) return res.status(404).json({ error: 'Tab not found' });

  if (tab.resurrected_at) {
    return res.status(409).json({ error: 'Tab already resurrected' });
  }

  const age = Date.now() - new Date(tab.buried_at).getTime();

  if (age > GRACE_PERIOD_MS) {
    return res.status(410).json({ error: 'Resurrection grace period expired' });
  }

  db.prepare('UPDATE tabs SET resurrected_at = ? WHERE id = ?')
    .run(new Date().toISOString(), Number(req.params.id));

  res.json({
    message: 'Tab resurrected successfully',
    tab: getTab(Number(req.params.id))
  });
});

app.delete('/graveyard/:id', (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tab ID' });
  }

  const tab = getTab(Number(req.params.id));
  if (!tab) return res.status(404).json({ error: 'Tab not found' });

  if (tab.resurrected_at) {
    return res.status(409).json({ error: 'Resurrected tabs cannot be deleted' });
  }

  const age = Date.now() - new Date(tab.buried_at).getTime();

  if (age <= GRACE_PERIOD_MS) {
    return res.status(403).json({
      error: 'Cannot delete during the 24-hour grace period'
    });
  }

  db.prepare('DELETE FROM tabs WHERE id = ?').run(Number(req.params.id));
  res.status(204).end();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Graveyard API running at http://localhost:${PORT}`);
  });
}

module.exports = { app, db };
