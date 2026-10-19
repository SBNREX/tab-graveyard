
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-graveyard-test-'));
process.env.DATABASE_PATH = path.join(testDir, 'test.db');

const request = require('supertest');
const { app, db } = require('../server');

const validTab = {
  title: 'Test tab',
  url: 'https://example.com',
  cause: 'RESEARCH',
  notes: 'Automated test'
};

beforeEach(() => {
  db.prepare('DELETE FROM tabs').run();
});

after(() => {
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('GET /health returns healthy status', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('POST /bury creates a tab', async () => {
  const res = await request(app).post('/bury').send(validTab);
  assert.equal(res.status, 201);
  assert.equal(res.body.title, validTab.title);
  assert.equal(res.body.cause, validTab.cause);
  assert.ok(res.body.id);
});

test('POST /bury rejects an invalid cause', async () => {
  const res = await request(app)
    .post('/bury')
    .send({ ...validTab, cause: 'INVALID' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /cause must be one of/);
});

test('GET /graveyard lists buried tabs', async () => {
  await request(app).post('/bury').send(validTab);
  const res = await request(app).get('/graveyard');
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.tabs[0].title, validTab.title);
});

test('GET /graveyard/cause/:cause filters by cause', async () => {
  await request(app).post('/bury').send(validTab);
  const res = await request(app).get('/graveyard/cause/research');
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.tabs[0].cause, 'RESEARCH');
});

test('PATCH /graveyard/:id updates notes', async () => {
  const created = await request(app).post('/bury').send(validTab);
  const res = await request(app)
    .patch(`/graveyard/${created.body.id}`)
    .send({ notes: 'Updated by test' });
  assert.equal(res.status, 200);
  assert.equal(res.body.notes, 'Updated by test');
});

test('POST /resurrect/:id resurrects a tab', async () => {
  const created = await request(app).post('/bury').send(validTab);
  const id = created.body.id;
  const res = await request(app).post(`/resurrect/${id}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.tab.resurrected_at);

  const second = await request(app).post(`/resurrect/${id}`);
  assert.equal(second.status, 409);

  const list = await request(app).get('/graveyard');
  assert.equal(list.body.count, 0);
});

test('DELETE respects the grace period', async () => {
  const created = await request(app).post('/bury').send(validTab);
  const res = await request(app)
    .delete(`/graveyard/${created.body.id}`);
  assert.equal(res.status, 403);
});

test('GET /graveyard/:id returns 404 for a missing tab', async () => {
  const res = await request(app).get('/graveyard/999999');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Tab not found');
});
