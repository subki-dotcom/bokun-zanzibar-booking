process.env.NODE_ENV = 'test';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/bi-route-test';
process.env.JWT_SECRET ||= 'bi-route-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const User = require('../src/models/User');
const service = require('../src/analytics/businessIntelligenceService');

test('BI route preserves authentication, permission enforcement and validated section/date contract', async () => {
  const originalUser = User.findById;
  const originalReport = service.getBusinessIntelligence;
  let role = 'staff', calls = 0;
  User.findById = () => ({ lean: async () => ({ _id: '66ffffffffffffffffffffff', role, isActive: true, email: 'bi@example.test' }) });
  service.getBusinessIntelligence = async (query) => { calls++; return { query, currency: 'EUR' }; };
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/admin/analytics/business-intelligence`;
  const headers = { Authorization: `Bearer ${jwt.sign({ sub: '66ffffffffffffffffffffff', userType: 'user' }, process.env.JWT_SECRET, { expiresIn: '5m' })}` };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers })).status, 403);
    assert.equal(calls, 0);
    role = 'admin';
    assert.equal((await fetch(`${url}?section=invalid`, { headers })).status, 422);
    assert.equal((await fetch(`${url}?period=CUSTOM&from=2026-02-30&to=2026-03-01`, { headers })).status, 422);
    assert.equal(calls, 0);
    const response = await fetch(`${url}?section=operations&period=CUSTOM&from=2026-08-01&to=2026-08-31`, { headers });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.data.currency, 'EUR');
    assert.deepEqual(result.data.query, { section: 'operations', period: 'CUSTOM', from: '2026-08-01', to: '2026-08-31' });
    assert.equal(calls, 1);
  } finally {
    User.findById = originalUser;
    service.getBusinessIntelligence = originalReport;
    await new Promise((resolve) => server.close(resolve));
  }
});
