// SMTP sending (Nodemailer) for messages to the team's own inbox. Settings come only from the environment:
// SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM. The transport is made once and reused.
const nodemailer = require("nodemailer");
const { env } = require("../../config/env");

let transport = null;

const isSmtpConfigured = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

const smtpTransport = () => {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 465),
      secure: Boolean(env.SMTP_SECURE),
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    });
  }
  return transport;
};

// The sender: MAIL_FROM, else the brand name with the SMTP account address.
const mailFrom = () => {
  if (env.MAIL_FROM) return env.MAIL_FROM;
  const address = env.SMTP_USER || (String(env.EMAIL_FROM || "").match(/<([^>]+)>/) || [null, env.EMAIL_FROM])[1];
  return address ? `${String(env.BRAND_NAME || "").replace(/[<>"]/g, "")} <${address}>` : "";
};

const sendSmtpMail = (message) => smtpTransport().sendMail({ from: mailFrom(), ...message });

// Tests swap the transport (e.g. nodemailer's jsonTransport) without real SMTP settings.
const setTransportForTests = (next) => {
  transport = next;
};

module.exports = { isSmtpConfigured, sendSmtpMail, mailFrom, setTransportForTests };
