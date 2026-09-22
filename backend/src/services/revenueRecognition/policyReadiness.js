const REQUIRED_POLICY_QUESTIONS = Object.freeze([
  ["revenueAccount", "What account receives service revenue?"],
  ["customerDepositAccount", "What account represents customer money received before service?"],
  ["directReceivableAccount", "What account represents unpaid direct receivables?"],
  ["otaReceivableAccount", "What account represents OTA receivables?"],
  ["commissionPolicy", "How are GYG/Viator commissions accounted for?"],
  ["grossNetPolicy", "Is revenue presented gross or net?"],
  ["processorFeePolicy", "How are processor fees accounted for?"],
  ["refundPolicy", "How are refunds after recognition accounted for?"],
  ["cancellationPolicy", "How are cancellation fees accounted for?"],
  ["baseCurrency", "What is the ledger/base currency?"],
  ["fxPolicy", "What FX basis is approved?"],
  ["postingDatePolicy", "Which posting date policy is used?"]
]);

const buildPolicyReadiness = ({ mappings = [], configuredPolicy = {} } = {}) => {
  const supportedMappings = new Set(mappings.map((mapping) => mapping.mappingKey || mapping.key));
  const answers = Object.fromEntries(REQUIRED_POLICY_QUESTIONS.map(([key, question]) => [key, { question, answer: configuredPolicy[key] || null, supported: Boolean(configuredPolicy[key]) }]));
  answers.revenueAccount.supported ||= supportedMappings.has("TOUR_REVENUE") || supportedMappings.has("TRANSFER_REVENUE") || supportedMappings.has("OTHER_SERVICE_REVENUE");
  answers.baseCurrency.supported ||= Boolean(process.env.ACCOUNTING_BASE_CURRENCY || process.env.DEFAULT_CURRENCY);
  const missing = Object.entries(answers).filter(([, value]) => !value.supported).map(([key]) => key);
  return { status: missing.length ? "GL_AUTOMATION_BLOCKED_BY_ACCOUNTING_POLICY" : "POLICY_READY_FOR_REVIEW", automaticGlPostingEnabled: false, missing, answers };
};

module.exports = { REQUIRED_POLICY_QUESTIONS, buildPolicyReadiness };