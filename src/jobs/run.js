'use strict';
/* Run a job by hand:  npm run job:daily -- morning */
const jobs = require('./daily');
const which = process.argv[2] || 'morning';
(jobs[which] ? jobs[which]() : Promise.reject(new Error('unknown job: ' + which)))
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
