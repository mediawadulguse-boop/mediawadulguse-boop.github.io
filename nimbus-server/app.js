'use strict';
const { database } = require('./lib/database.cjs');
const { createServer } = require('./lib/http.cjs');
if (
  process.env.NODE_ENV === 'production' &&
  !/^https:\/\/[^/]+\/?$/.test(process.env.PUBLIC_URL || '')
)
  throw new Error('PUBLIC_URL wajib diisi dengan origin HTTPS aplikasi.');
const pool = database(),
  server = createServer(pool);
server.listen(process.env.PORT || 3000, () =>
  console.log('MEDIA WADUL API aktif.'),
);
async function stop() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
