import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { createApp } from './index.js';

let server;
let base;
let dataDir;
let ownerCookie;
let owner;
let project;

async function api(path, options = {}, cookie = ownerCookie) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { ...options, headers });
  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch { body = raw; }
  return { response, body };
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'forgehouse-test-'));
  const app = createApp({ dataDir, generationDelay: 100 });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

test('health and readiness expose safe configuration state', async () => {
  const health = await api('/api/health', {}, null);
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(typeof health.body.groqConfigured, 'boolean');
  const ready = await api('/api/ready', {}, null);
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.ready, true);
});

test('registration creates a session and private project access is enforced', async () => {
  const registered = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Owner', email: 'owner@example.com', password: 'correct-horse' }) }, null);
  assert.equal(registered.response.status, 201);
  ownerCookie = registered.response.headers.get('set-cookie');
  owner = registered.body.user;
  assert.equal(owner.email, 'owner@example.com');
  const projects = await api('/api/projects');
  assert.equal(projects.response.status, 200);
  assert.ok(projects.body.some(item => item.ownerId === owner.id));
  const unauthenticated = await api('/api/projects', {}, null);
  assert.equal(unauthenticated.response.status, 401);
});

test('project creation and generation jobs create durable revisions', async () => {
  const created = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Launch project', description: 'A launch page' }) });
  assert.equal(created.response.status, 201);
  project = created.body;
  assert.equal(project.revisions.length, 1);
  const started = await api('/api/projects/' + project.id + '/generate', { method: 'POST', body: JSON.stringify({ prompt: 'Change the palette to ocean blue' }) });
  assert.equal(started.response.status, 202);
  assert.equal(started.body.job.status, 'queued');
  let result;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 40));
    result = await api('/api/projects/' + project.id + '/jobs/' + started.body.job.id);
    if (['succeeded', 'failed', 'cancelled'].includes(result.body.job.status)) break;
  }
  assert.equal(result.body.job.status, 'succeeded');
  assert.equal(result.body.project.revisions.length, 2);
  assert.match(result.body.project.revisions[0].files.find(file => file.path === 'styles.css').content, /#8fc5d8/);
});

test('queued generation jobs can be cancelled before execution', async () => {
  const started = await api('/api/projects/' + project.id + '/generate', { method: 'POST', body: JSON.stringify({ prompt: 'Make a queued change' }) });
  assert.equal(started.response.status, 202);
  const cancelled = await api('/api/projects/' + project.id + '/jobs/' + started.body.job.id + '/cancel', { method: 'POST' });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.job.status, 'cancelled');
  const status = await api('/api/projects/' + project.id + '/jobs/' + started.body.job.id);
  assert.equal(status.body.job.status, 'cancelled');
});

test('restore, asset validation, publication, and public CSP work together', async () => {
  const current = await api('/api/projects/' + project.id);
  const originalRevision = current.body.revisions[current.body.revisions.length - 1];
  const restored = await api('/api/projects/' + project.id + '/revisions/' + originalRevision.id + '/restore', { method: 'POST' });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.revisions.length, 3);
  const invalidAsset = await api('/api/projects/' + project.id + '/assets', { method: 'POST', body: JSON.stringify({ name: 'script.svg', mimeType: 'image/svg+xml', data: 'bad' }) });
  assert.equal(invalidAsset.response.status, 400);
  const validAsset = await api('/api/projects/' + project.id + '/assets', { method: 'POST', body: JSON.stringify({ name: 'pixel.png', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }) });
  assert.equal(validAsset.response.status, 201);
  const published = await api('/api/projects/' + project.id + '/publish', { method: 'POST' });
  assert.equal(published.response.status, 200);
  const site = await api('/sites/' + published.body.slug, {}, null);
  assert.equal(site.response.status, 200);
  assert.match(site.response.headers.get('content-security-policy'), /connect-src 'none'/);
  const asset = await api(validAsset.body.url, {}, null);
  assert.equal(asset.response.status, 200);
});

test('second user cannot access the first user project', async () => {
  const registered = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Second', email: 'second@example.com', password: 'correct-horse' }) }, null);
  assert.equal(registered.response.status, 201);
  const secondCookie = registered.response.headers.get('set-cookie');
  const forbidden = await api('/api/projects/' + project.id, {}, secondCookie);
  assert.equal(forbidden.response.status, 404);
  const logout = await api('/api/auth/logout', { method: 'POST' }, secondCookie);
  assert.equal(logout.response.status, 200);
});
