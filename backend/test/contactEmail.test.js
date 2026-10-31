// Contact page email: content, escaping, SMTP delivery and failures, and the HTTP answer the page expects.
// The HTTP part needs MY_BOOKING_TEST_MONGO_URI (a throwaway database).
process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27018/unused";
process.env.JWT_SECRET ||= "contact-email-test-secret";
process.env.FRONTEND_URL = "http://localhost:5173";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const emailService = require("../src/services/email");
const smtp = require("../src/services/email/smtp");

const visitor = {
  name: 'Amani <script>alert("x")</script>',
  email: "amani@example.test",
  phone: "+255 712 345 678",
  travelDate: "2026-12-04",
  message: "Hello <b>team</b>,\nwe are 4 & would like Mnemba."
};

test("the email has the subject, every field, and escaped HTML", () => {
  const { subject, html, text } = emailService.buildContactEmail(visitor);
  assert.equal(subject, 'New contact message from Amani <script>alert("x")</script>');
  assert.ok(!html.includes("<script>") && !html.includes("<b>team</b>"));
  assert.ok(html.includes("&lt;script&gt;") && html.includes("&lt;b&gt;team&lt;/b&gt;") && html.includes("4 &amp; would"));
  for (const value of [visitor.email, visitor.phone, visitor.travelDate]) assert.ok(html.includes(value) && text.includes(value), value);
  assert.match(text, /Message:\nHello <b>team<\/b>,\nwe are 4 & would like Mnemba\./);
});

test("no line breaks reach the subject", () => {
  const { subject } = emailService.buildContactEmail({ ...visitor, name: "Amani\r\nBcc: someone@evil.test" });
  assert.equal(subject, "New contact message from Amani Bcc: someone@evil.test");
});

test("SMTP: sent to the team inbox with Reply-To the visitor", async (t) => {
  const sent = [];
  smtp.setTransportForTests({ sendMail: async (message) => sent.push(message) });
  t.after(() => smtp.setTransportForTests(null));
  const result = await emailService.sendContactMessage(visitor, { smtpReady: true, resendReady: false });
  assert.deepEqual(result, { sent: true, via: "smtp" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "info@zanzibartoursandsafaris.co.tz");
  assert.equal(sent[0].replyTo, visitor.email);
  assert.match(sent[0].subject, /^New contact message from /);
  assert.ok(sent[0].html && sent[0].text);
});

test("SMTP failure: reported as not sent, without server details", async (t) => {
  smtp.setTransportForTests({
    sendMail: async () => {
      const error = new Error("Invalid login: 535 Authentication failed for smtp.secret-host.test user info@x");
      error.code = "EAUTH";
      error.responseCode = 535;
      throw error;
    }
  });
  t.after(() => smtp.setTransportForTests(null));
  assert.deepEqual(await emailService.sendContactMessage(visitor, { smtpReady: true }), { sent: false, reason: "provider_error" });
});

test("without SMTP or Resend settings nothing is sent", async () => {
  assert.deepEqual(await emailService.sendContactMessage(visitor, { smtpReady: false, resendReady: false }), { sent: false, reason: "email_not_configured" });
});

const MONGO = process.env.MY_BOOKING_TEST_MONGO_URI;
test("HTTP: saved first; a failed email answers 502 with a clear message; success keeps the response format", { skip: !MONGO }, async (t) => {
  const app = require("../src/app");
  const MarketingLead = require("../src/models/MarketingLead");
  await mongoose.connect(MONGO, { dbName: `contact_test_${process.pid}_${crypto.randomBytes(4).toString("hex")}` });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const original = emailService.sendContactMessage;
  t.after(async () => {
    emailService.sendContactMessage = original;
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  const post = (body, ip) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/marketing/contact`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": ip },
      body: JSON.stringify(body)
    }).then(async (response) => ({ status: response.status, json: await response.json() }));

  emailService.sendContactMessage = async () => ({ sent: false, reason: "provider_error" });
  const failed = await post({ ...visitor, email: "fail@example.test" }, "10.4.0.1");
  assert.equal(failed.status, 502);
  assert.equal(failed.json.message, "We could not send your message. Please try again, or contact us on WhatsApp.");
  assert.equal(failed.json.error.code, "CONTACT_EMAIL_FAILED");
  assert.ok(!JSON.stringify(failed.json).match(/smtp|535|EAUTH|provider_error/i));
  assert.ok(await MarketingLead.exists({ email: "fail@example.test" }), "the message is still saved");

  emailService.sendContactMessage = async () => ({ sent: true, via: "smtp" });
  const ok = await post(visitor, "10.4.0.2");
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.data, { received: true, emailed: true });

  // Robots filling the hidden "website" field get the same success and nothing is sent or kept.
  emailService.sendContactMessage = async () => {
    throw new Error("must not be called");
  };
  const robot = await post({ ...visitor, email: "bot@example.test", website: "http://spam.test" }, "10.4.0.3");
  assert.equal(robot.status, 200);
  assert.ok(!(await MarketingLead.exists({ email: "bot@example.test" })));
});
