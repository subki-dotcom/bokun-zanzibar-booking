// Dedicated disposable replica set: never loads .env or connects to the application DB.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { MongoClient } = require('mongoose').mongo;
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
const run = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'riser-revenue-test-'));
  const port = await freePort();
  const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
  const mongo = spawn(
    process.env.REVENUE_TEST_MONGOD || 'mongod',
    [
      '--dbpath',
      directory,
      '--bind_ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--replSet',
      'revenueTest',
      '--logpath',
      path.join(directory, 'mongo.log'),
    ],
    { windowsHide: true, stdio: 'ignore' }
  );
  let startupError;
  mongo.on('error', (error) => {
    startupError = error;
  });
  let client;
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (startupError) throw startupError;
      client = new MongoClient(uri, { serverSelectionTimeoutMS: 400 });
      try {
        await client.connect();
        break;
      } catch {
        await client.close();
        client = null;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!client) throw new Error('Isolated MongoDB did not start');
    await client
      .db('admin')
      .command({
        replSetInitiate: { _id: 'revenueTest', members: [{ _id: 0, host: `127.0.0.1:${port}` }] },
      });
    let primary = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) {
        primary = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!primary) throw new Error('Isolated replica set did not elect a primary');
    const args = process.argv.includes('--full')
      ? ['--test']
      : [
          '--test',
          'test/revenueRecognitionPolicy.test.js',
          'test/revenueRecognition.integration.test.js',
        ];
    const child = spawn(process.execPath, args, {
      cwd: path.resolve(__dirname, '..'),
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MONGO_URI: 'mongodb://127.0.0.1:1/never_application',
        JWT_SECRET: 'isolated-revenue-tests-not-a-real-secret',
        BOKUN_MOCK_MODE: 'true',
        REVENUE_TEST_MONGO_URI: `mongodb://127.0.0.1:${port}/revenue_test?replicaSet=revenueTest`,
        BOOKING_PAYMENT_TEST_MONGO_URI: '',
        BI_TEST_MONGO_URI: '',
        REVENUE_RECOGNITION_AUTOMATIC_ENABLED: 'false',
        AR_AUTOMATIC_RECOGNITION_ENABLED: 'false',
        CUSTOMER_PAYMENT_AUTOMATIC_POSTING_ENABLED: 'false',
      },
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    if (client) await client.close();
    const exited = new Promise((resolve) => {
      if (mongo.exitCode !== null) resolve();
      else mongo.once('exit', resolve);
    });
    mongo.kill();
    await exited;
    // Only remove the directory created by this invocation, after checking its absolute parent.
    if (
      path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('riser-revenue-test-')
    )
      fs.rmSync(directory, { recursive: true, force: true });
  }
};
run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
