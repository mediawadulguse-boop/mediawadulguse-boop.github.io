'use strict';
const { database } = require('../lib/database.cjs');
const { runOne } = require('../lib/worker.cjs');
(async () => {
  const pool = database();
  try {
    for (let i = 0; i < 10; i++) if (!(await runOne(pool))) break;
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error('Worker gagal:', e.code || e.name);
  process.exitCode = 1;
});
