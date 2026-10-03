const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { MongoClient } = require('mongodb');

test('database connection negotiates built-in zlib and preserves index initialization', async () => {
  const calls = [];
  const uri = 'mongodb://127.0.0.1:27017/bandwidth_unit_test';
  const dependencies = {
    mongoose: { set: () => {}, connect: async (target, options) => {
      assert.equal(target, uri);
      // Parse options with the installed driver without opening a connection.
      const client = new MongoClient(target, options);
      assert.deepEqual(client.options.compressors, ['zlib']);
      assert.equal(client.options.zlibCompressionLevel, 3);
      calls.push('connect');
    } },
    './env': { env: { MONGO_URI: uri } },
    './logger': { info: () => {}, error: () => {} }
  };
  for (const name of ['Booking', 'RevenueRecognition', 'JournalEntry']) {
    dependencies[`../models/${name}`] = { createIndexes: async () => calls.push(name) };
  }
  const context = { module: { exports: {} }, require: name => {
    assert.ok(dependencies[name], `Unexpected dependency ${name}`);
    return dependencies[name];
  }, process: { exit: () => assert.fail('Connection setup failed') } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/config/db'), 'utf8'), context);
  await context.module.exports();
  assert.deepEqual(calls, ['connect', 'Booking', 'RevenueRecognition', 'JournalEntry']);
});
