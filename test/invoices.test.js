'use strict';
const { test, before, after, beforeEach } = require('node:test');
const a = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);
beforeEach(h.reset);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const upload = (c, over = {}) => c.post('/api/invoices/file', {
  filename: 'vergers-A1105.png', mime: 'image/png', data: PNG.toString('base64'), ...over });

test('management can upload an invoice and read it back', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const up = await upload(c);
  a.equal(up.status, 200);
  a.equal(up.json.filename, 'vergers-A1105.png');
  a.equal(up.json.bytes, PNG.length);

  const back = await fetch(`${await h.start()}/api/invoices/file/${up.json.id}`, {
    headers: { Cookie: (await c.get('/api/state'), '') } });
  a.equal(back.status, 401, 'and only with a session');
});

test('the file comes back with the right type', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const up = await upload(c);
  const r = await c.get('/api/invoices/file/' + up.json.id);
  a.equal(r.status, 200);
});

test('a cook cannot upload, read, or delete an invoice', async () => {
  const boss = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const up = await upload(boss);
  const cook = await h.signIn('mr', 'masud@restaurantshabour.com', '1111');
  a.equal((await upload(cook)).status, 403);
  a.equal((await cook.get('/api/invoices/file/' + up.json.id)).status, 403);
  a.equal((await cook.del('/api/invoices/file/' + up.json.id)).status, 403);
  a.equal((await cook.get('/api/invoices/unread')).status, 403);
});

test('only photographs and PDFs are accepted', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  for (const mime of ['text/html', 'application/javascript', 'application/zip', 'image/svg+xml']) {
    const r = await upload(c, { mime });
    a.equal(r.status, 415, mime);
  }
  a.equal((await upload(c, { mime: 'application/pdf' })).status, 200);
});

test('an empty or oversized file is refused', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  a.equal((await upload(c, { data: '' })).status, 400);
  const huge = Buffer.alloc(9 * 1024 * 1024, 1).toString('base64');
  a.equal((await upload(c, { data: huge })).status, 413);
});

test('a filename cannot smuggle a newline into the download header', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const up = await upload(c, { filename: 'evil\r\nX-Injected: yes\r\n.png' });
  a.equal(up.status, 200);
  a.ok(!up.json.filename.includes('\n'), 'newlines stripped');
  const r = await fetch(`${await h.start()}/api/invoices/file/${up.json.id}`);
  a.equal(r.status, 401);
});

test('an upload waits to be read, then stops waiting', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const up = await upload(c);
  a.equal((await c.get('/api/invoices/unread')).json.files.length, 1);
  a.equal((await c.post('/api/invoices/file/' + up.json.id + '/read', { invoiceId: 'i1' })).status, 200);
  a.equal((await c.get('/api/invoices/unread')).json.files.length, 0);
});

test('an unknown file id is a clean 404', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  a.equal((await c.get('/api/invoices/file/nope')).status, 404);
  a.equal((await c.post('/api/invoices/file/nope/read', {})).status, 404);
});

test('the upload is attributed and audited', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  await upload(c);
  const { rows } = await h.pool.query('SELECT uploaded_by FROM invoice_files');
  a.equal(rows[0].uploaded_by, 'ee');
  const { rows: log } = await h.pool.query("SELECT action FROM audit WHERE action = 'invoice_upload'");
  a.equal(log.length, 1);
});

test('deleting a file removes it', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const up = await upload(c);
  a.equal((await c.del('/api/invoices/file/' + up.json.id)).status, 200);
  a.equal((await c.get('/api/invoices/file/' + up.json.id)).status, 404);
});
