const POLICY_ID = "RISER_ACCOUNTING_POLICY_V1";
const POLICY_VERSION = 1;
const BASE_CURRENCY = "USD";
const ACCOUNTS = Object.freeze({
  CASH: "1010", BANK: "1020", PESAPAL: "1030", PAYPAL: "1040", DPO: "1050", AR: "1100", CUSTOMER_DEPOSIT: "2030",
  REFUND_PAYABLE: "2040", TOUR_REVENUE: "4010", TRANSFER_REVENUE: "4020", OTHER_REVENUE: "4040", PROCESSOR_FEE: "6060", REFUND_ALLOWANCE: "7910"
});
const resolveServiceRevenueAccount = (serviceType = "") => ({ TOUR: ACCOUNTS.TOUR_REVENUE, TRANSFER: ACCOUNTS.TRANSFER_REVENUE, OTHER_SUPPORTED_SERVICE: ACCOUNTS.OTHER_REVENUE }[String(serviceType).trim().toUpperCase()] || null);
const resolveProcessorAccount = (provider = "") => ({ PESAPAL: ACCOUNTS.PESAPAL, PAYPAL: ACCOUNTS.PAYPAL, DPO: ACCOUNTS.DPO, CASH: ACCOUNTS.CASH, MANUAL_BANK: ACCOUNTS.BANK }[String(provider).trim().toUpperCase()] || null);
const resolveAccountingPolicy = ({ source = "DIRECT_WEBSITE", currency = BASE_CURRENCY, serviceType = "" } = {}) => ({ policyId: POLICY_ID, policyVersion: POLICY_VERSION, baseCurrency: BASE_CURRENCY, source: String(source).toUpperCase(), currency: String(currency).toUpperCase(), serviceType: String(serviceType).toUpperCase(), directAdvanceAccount: ACCOUNTS.CUSTOMER_DEPOSIT, directReceivableAccount: ACCOUNTS.AR, revenueAccount: resolveServiceRevenueAccount(serviceType), processorAccount: resolveProcessorAccount(source), otaApproval: "ACCOUNTANT_CONFIRMATION_PENDING", fx: String(currency).toUpperCase() === BASE_CURRENCY ? "IDENTITY" : "FX_POLICY_BLOCKED" });
module.exports = { POLICY_ID, POLICY_VERSION, BASE_CURRENCY, ACCOUNTS, resolveServiceRevenueAccount, resolveProcessorAccount, resolveAccountingPolicy };
