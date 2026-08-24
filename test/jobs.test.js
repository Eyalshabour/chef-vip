'use strict';
const { test, before, after, beforeEach } = require('node:test');
const a = require('node:assert/strict');
const h = require('./helpers');
const jobs = require('../src/jobs/daily');

before(h.start);
after(h.stop);
beforeEach(h.reset);

const board = async () => (await h.pool.query('SELECT rev, state FROM board WHERE id = 1')).rows[0];
const setState = (s) => h.pool.query('UPDATE board SET state = $1 WHERE id = 1', [s]);

test('the morning job opens the service and resets the rounds', async () => {
  const b = await board();
  b.state.serviceDate = '1999-01-01';
  b.state.clean.forEach(c => { c.done = true; c.by = 'mr'; });
  b.state.haccp.forEach(x => { x.done = true; x.value = '4'; });
  await setState(b.state);

  await jobs.morning();

  const after = (await board()).state;
  a.notEqual(after.serviceDate, '1999-01-01');
  a.equal(after.clean.filter(c => c.done).length, 0, 'cleaning starts clean');
  a.equal(after.haccp.filter(x => x.done).length, 0, 'so does the HACCP round');
  a.equal(after.haccp.filter(x => x.value).length, 0, 'and yesterday\'s temperatures are gone');
});

test('the morning job keeps unfinished prep and drops what was done', async () => {
  const b = await board();
  b.state.serviceDate = '1999-01-01';
  b.state.prep = [
    { id: 'a', title: 'Bisque', done: true },
    { id: 'b', title: 'Urfa Oil', done: false },
    { id: 'c', title: 'Fish Stock', done: false, restr: 'CUT' },
  ];
  await setState(b.state);

  await jobs.morning();

  const after = (await board()).state;
  a.deepEqual(after.prep.map(p => p.id), ['b', 'c'], 'finished work does not come back');
  a.equal(after.prep[1].restr, 'CUT', 'and the notes on it survive');
});

test('the morning job is idempotent within a day', async () => {
  await jobs.morning();
  const first = await board();
  await jobs.morning();
  const second = await board();
  a.deepEqual(second.state.prep.length, first.state.prep.length);
  a.equal(second.state.serviceDate, first.state.serviceDate);
});

test('the evening job records what was left, and says nothing when all is done', async () => {
  const b = await board();
  b.state.prep = [{ id: 'a', title: 'Bisque', done: false, arch: false }];
  b.state.clean.forEach(c => { c.done = true; });
  b.state.haccp.forEach(x => { x.done = true; });
  b.state.notes = [];
  await setState(b.state);

  await jobs.evening();
  let after = (await board()).state;
  a.equal(after.notes.length, 1);
  a.match(after.notes[0].text, /1 prep/);

  after.prep[0].done = true;
  after.notes = [];
  await setState(after);
  await jobs.evening();
  a.equal((await board()).state.notes.length, 0, 'a clean night leaves no note');
});

test('the evening job ignores archived prep', async () => {
  const b = await board();
  b.state.prep = [{ id: 'a', title: 'old thing', done: false, arch: true }];
  b.state.clean.forEach(c => { c.done = true; });
  b.state.haccp.forEach(x => { x.done = true; });
  b.state.notes = [];
  await setState(b.state);
  await jobs.evening();
  a.equal((await board()).state.notes.length, 0, 'old preps are not outstanding work');
});

test('a job that loses the race leaves the board alone', async () => {
  const b = await board();
  const stale = b.rev;
  await h.pool.query('UPDATE board SET rev = rev + 1 WHERE id = 1');   // someone else saved
  const wrote = await jobs.writeBoard(stale, { poisoned: true }, 'job_test');
  a.equal(wrote, false);
  const after = await board();
  a.equal(after.state.poisoned, undefined, 'the board was not overwritten');
});

test('the cron lines cover Monday to Saturday', () => {
  const m = process.env.JOB_MORNING || '17 8 * * 1-6';
  const e = process.env.JOB_EVENING || '41 15 * * 1-6';
  for (const line of [m, e]) {
    a.equal(line.split(' ')[4], '1-6', 'the kitchen closes Sundays only');
    a.ok(!/^0 /.test(line), 'and the job avoids the top of the minute');
  }
});
