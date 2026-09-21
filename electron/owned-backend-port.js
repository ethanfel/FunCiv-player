const net = require('node:net');

/** Probe an available loopback port without terminating its current owner. */
async function availablePort(preferred = 5124) {
  const probe = port => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const selected = server.address().port;
      server.close(() => resolve(selected));
    });
  });
  try { return await probe(preferred); }
  catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    return probe(0);
  }
}

module.exports = { availablePort };
