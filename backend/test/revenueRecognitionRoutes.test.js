process.env.NODE_ENV = 'test';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'isolated-routes-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const User = require('../src/models/User');
const revenue = require('../src/services/revenueRecognition');
const userId = '66cccccccccccccccccccccc';
test('staff cannot approve FX, post or reverse revenue; admin retries cannot override the automatic gate', async () => {
  const originalUser = User.findById;
  const originalPost = revenue.post;
  let role = 'staff';
  let calls = 0;
  User.findById = () => ({ lean: async () => ({ _id: userId, role, isActive: true }) });
  revenue.post = async (input) => {
    calls += 1;
    assert.equal(input.origin, 'AUTOMATIC');
    return { action: 'preview' };
  };
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const headers = {
    Authorization: `Bearer ${jwt.sign({ sub: userId, userType: 'user' }, process.env.JWT_SECRET)}`,
    'content-type': 'application/json',
  };
  const base = `http://127.0.0.1:${server.address().port}/api/admin/service-completions/66dddddddddddddddddddddd`;
  try {
    for (const route of ['revenue-post', 'revenue-evidence', 'revenue-reverse']) {
      assert.equal(
        (await fetch(`${base}/${route}`, { method: 'POST', headers, body: '{}' })).status,
        403
      );
    }
    assert.equal(calls, 0);
    role = 'admin';
    assert.equal(
      (
        await fetch(`${base}/revenue-post`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ origin: 'MANUAL', force: true }),
        })
      ).status,
      200
    );
    assert.equal(calls, 1);
    assert.equal(
      (
        await fetch(`${base}/revenue-evidence`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            reference: 'x',
            reason: 'x',
            fx: {
              rate: '-1',
              source: 'bank',
              date: '2026-09-21',
              fromCurrency: 'EUR',
              toCurrency: 'USD',
            },
          }),
        })
      ).status,
      422
    );
  } finally {
    User.findById = originalUser;
    revenue.post = originalPost;
    await new Promise((resolve) => server.close(resolve));
  }
});
