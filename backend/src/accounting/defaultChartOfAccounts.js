const {
  BUSINESS_UNIT,
  GL_ACCOUNT_NORMAL_BALANCE,
  GL_ACCOUNT_SUBTYPE,
  GL_ACCOUNT_TYPE
} = require("./constants");

const defaultAccount = (values) => ({
  businessUnit: BUSINESS_UNIT.GENERAL_COMPANY,
  currency: "",
  active: true,
  systemAccount: true,
  allowManualPosting: true,
  ...values
});

const DEFAULT_CHART_OF_ACCOUNTS = Object.freeze([
  defaultAccount({
    code: "1000",
    name: "Current Assets",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.CURRENT_ASSET,
    allowManualPosting: false
  }),
  defaultAccount({
    code: "1010",
    name: "Cash on Hand",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.CASH,
    parentCode: "1000"
  }),
  defaultAccount({
    code: "1020",
    name: "Operating Bank",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.BANK,
    parentCode: "1000"
  }),
  defaultAccount({
    code: "1030",
    name: "Pesapal Clearing",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.PROVIDER_CLEARING,
    parentCode: "1000"
  }),
  defaultAccount({
    code: "1040",
    name: "PayPal Clearing",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.PROVIDER_CLEARING,
    parentCode: "1000"
  }),
  defaultAccount({
    code: "1050",
    name: "DPO Clearing",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.PROVIDER_CLEARING,
    parentCode: "1000"
  }),
  defaultAccount({
    code: "1060",
    name: "Mobile Money",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.MOBILE_MONEY,
    parentCode: "1000"
  }),
  defaultAccount({
    code: "1100",
    name: "Accounts Receivable",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.ACCOUNTS_RECEIVABLE,
    parentCode: "1000"
  }),
  defaultAccount({
    code: "1200",
    name: "Prepaid Expenses",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.PREPAID_EXPENSE,
    parentCode: "1000"
  }),
  defaultAccount({
    code: "1500",
    name: "Fixed Assets",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.FIXED_ASSET,
    allowManualPosting: false
  }),
  defaultAccount({
    code: "1590",
    name: "Accumulated Depreciation",
    type: GL_ACCOUNT_TYPE.ASSET,
    subtype: GL_ACCOUNT_SUBTYPE.ACCUMULATED_DEPRECIATION,
    parentCode: "1500",
    normalBalance: GL_ACCOUNT_NORMAL_BALANCE.CREDIT
  }),
  defaultAccount({
    code: "2000",
    name: "Current Liabilities",
    type: GL_ACCOUNT_TYPE.LIABILITY,
    subtype: GL_ACCOUNT_SUBTYPE.CURRENT_LIABILITY,
    allowManualPosting: false
  }),
  defaultAccount({
    code: "2010",
    name: "Accounts Payable",
    type: GL_ACCOUNT_TYPE.LIABILITY,
    subtype: GL_ACCOUNT_SUBTYPE.ACCOUNTS_PAYABLE,
    parentCode: "2000"
  }),
  defaultAccount({
    code: "2020",
    name: "Supplier Payables",
    type: GL_ACCOUNT_TYPE.LIABILITY,
    subtype: GL_ACCOUNT_SUBTYPE.SUPPLIER_PAYABLE,
    parentCode: "2000"
  }),
  defaultAccount({
    code: "2030",
    name: "Customer Deposits",
    type: GL_ACCOUNT_TYPE.LIABILITY,
    subtype: GL_ACCOUNT_SUBTYPE.CUSTOMER_DEPOSIT,
    parentCode: "2000"
  }),
  defaultAccount({
    code: "2040",
    name: "Refund Payables",
    type: GL_ACCOUNT_TYPE.LIABILITY,
    subtype: GL_ACCOUNT_SUBTYPE.REFUND_PAYABLE,
    parentCode: "2000"
  }),
  defaultAccount({
    code: "2100",
    name: "Tax Payable",
    type: GL_ACCOUNT_TYPE.LIABILITY,
    subtype: GL_ACCOUNT_SUBTYPE.TAX_PAYABLE,
    parentCode: "2000"
  }),
  defaultAccount({
    code: "2200",
    name: "Payroll Payable",
    type: GL_ACCOUNT_TYPE.LIABILITY,
    subtype: GL_ACCOUNT_SUBTYPE.PAYROLL_PAYABLE,
    parentCode: "2000"
  }),
  defaultAccount({
    code: "3000",
    name: "Equity",
    type: GL_ACCOUNT_TYPE.EQUITY,
    subtype: GL_ACCOUNT_SUBTYPE.OWNER_EQUITY,
    allowManualPosting: false
  }),
  defaultAccount({
    code: "3010",
    name: "Owner Capital",
    type: GL_ACCOUNT_TYPE.EQUITY,
    subtype: GL_ACCOUNT_SUBTYPE.OWNER_CAPITAL,
    parentCode: "3000"
  }),
  defaultAccount({
    code: "3020",
    name: "Retained Earnings",
    type: GL_ACCOUNT_TYPE.EQUITY,
    subtype: GL_ACCOUNT_SUBTYPE.RETAINED_EARNINGS,
    parentCode: "3000",
    allowManualPosting: false
  }),
  defaultAccount({
    code: "3030",
    name: "Owner Drawings",
    type: GL_ACCOUNT_TYPE.EQUITY,
    subtype: GL_ACCOUNT_SUBTYPE.OWNER_DRAWING,
    parentCode: "3000",
    normalBalance: GL_ACCOUNT_NORMAL_BALANCE.DEBIT
  }),
  defaultAccount({
    code: "4000",
    name: "Operating Revenue",
    type: GL_ACCOUNT_TYPE.REVENUE,
    subtype: GL_ACCOUNT_SUBTYPE.OPERATING_REVENUE,
    allowManualPosting: false
  }),
  defaultAccount({
    code: "4010",
    name: "Tour Revenue",
    type: GL_ACCOUNT_TYPE.REVENUE,
    subtype: GL_ACCOUNT_SUBTYPE.TOUR_REVENUE,
    parentCode: "4000"
  }),
  defaultAccount({
    code: "4020",
    name: "Transfer Revenue",
    type: GL_ACCOUNT_TYPE.REVENUE,
    subtype: GL_ACCOUNT_SUBTYPE.TRANSFER_REVENUE,
    parentCode: "4000"
  }),
  defaultAccount({
    code: "4030",
    name: "Commission Revenue",
    type: GL_ACCOUNT_TYPE.REVENUE,
    subtype: GL_ACCOUNT_SUBTYPE.COMMISSION_REVENUE,
    parentCode: "4000"
  }),
  defaultAccount({
    code: "4040",
    name: "Other Service Revenue",
    type: GL_ACCOUNT_TYPE.REVENUE,
    subtype: GL_ACCOUNT_SUBTYPE.OTHER_SERVICE_REVENUE,
    parentCode: "4000"
  }),
  defaultAccount({
    code: "4090",
    name: "Discounts and Allowances",
    type: GL_ACCOUNT_TYPE.REVENUE,
    subtype: GL_ACCOUNT_SUBTYPE.CONTRA_REVENUE,
    parentCode: "4000",
    normalBalance: GL_ACCOUNT_NORMAL_BALANCE.DEBIT
  }),
  defaultAccount({
    code: "5000",
    name: "Cost of Sales",
    type: GL_ACCOUNT_TYPE.COST_OF_SALES,
    subtype: GL_ACCOUNT_SUBTYPE.DIRECT_COST,
    allowManualPosting: false
  }),
  defaultAccount({
    code: "5010",
    name: "Direct Supplier Costs",
    type: GL_ACCOUNT_TYPE.COST_OF_SALES,
    subtype: GL_ACCOUNT_SUBTYPE.DIRECT_SUPPLIER_COST,
    parentCode: "5000"
  }),
  defaultAccount({
    code: "5020",
    name: "Direct Transport Costs",
    type: GL_ACCOUNT_TYPE.COST_OF_SALES,
    subtype: GL_ACCOUNT_SUBTYPE.DIRECT_TRANSPORT_COST,
    parentCode: "5000"
  }),
  defaultAccount({
    code: "5030",
    name: "Direct Guide Costs",
    type: GL_ACCOUNT_TYPE.COST_OF_SALES,
    subtype: GL_ACCOUNT_SUBTYPE.DIRECT_GUIDE_COST,
    parentCode: "5000"
  }),
  defaultAccount({
    code: "5040",
    name: "Direct Boat Costs",
    type: GL_ACCOUNT_TYPE.COST_OF_SALES,
    subtype: GL_ACCOUNT_SUBTYPE.DIRECT_BOAT_COST,
    parentCode: "5000"
  }),
  defaultAccount({
    code: "5050",
    name: "Direct Activity Costs",
    type: GL_ACCOUNT_TYPE.COST_OF_SALES,
    subtype: GL_ACCOUNT_SUBTYPE.DIRECT_ACTIVITY_COST,
    parentCode: "5000"
  }),
  defaultAccount({
    code: "6000",
    name: "Operating Expenses",
    type: GL_ACCOUNT_TYPE.EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.OPERATING_EXPENSE,
    allowManualPosting: false
  }),
  defaultAccount({
    code: "6010",
    name: "Salaries and Wages",
    type: GL_ACCOUNT_TYPE.EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.SALARY_EXPENSE,
    parentCode: "6000"
  }),
  defaultAccount({
    code: "6020",
    name: "Office Rent",
    type: GL_ACCOUNT_TYPE.EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.RENT_EXPENSE,
    parentCode: "6000"
  }),
  defaultAccount({
    code: "6030",
    name: "Marketing and Advertising",
    type: GL_ACCOUNT_TYPE.EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.MARKETING_EXPENSE,
    parentCode: "6000"
  }),
  defaultAccount({
    code: "6040",
    name: "Software Subscriptions",
    type: GL_ACCOUNT_TYPE.EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.SOFTWARE_EXPENSE,
    parentCode: "6000"
  }),
  defaultAccount({
    code: "6050",
    name: "Bank Charges",
    type: GL_ACCOUNT_TYPE.EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.BANK_FEE_EXPENSE,
    parentCode: "6000"
  }),
  defaultAccount({
    code: "6060",
    name: "Payment Provider Fees",
    type: GL_ACCOUNT_TYPE.EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.PAYMENT_PROVIDER_FEE,
    parentCode: "6000"
  }),
  defaultAccount({
    code: "6070",
    name: "Insurance",
    type: GL_ACCOUNT_TYPE.EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.INSURANCE_EXPENSE,
    parentCode: "6000"
  }),
  defaultAccount({
    code: "6080",
    name: "Office Expenses",
    type: GL_ACCOUNT_TYPE.EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.OFFICE_EXPENSE,
    parentCode: "6000"
  }),
  defaultAccount({
    code: "7000",
    name: "Other Income",
    type: GL_ACCOUNT_TYPE.OTHER_INCOME,
    subtype: GL_ACCOUNT_SUBTYPE.OTHER_INCOME,
    allowManualPosting: false
  }),
  defaultAccount({
    code: "7010",
    name: "Interest Income",
    type: GL_ACCOUNT_TYPE.OTHER_INCOME,
    subtype: GL_ACCOUNT_SUBTYPE.INTEREST_INCOME,
    parentCode: "7000"
  }),
  defaultAccount({
    code: "7900",
    name: "Other Expenses",
    type: GL_ACCOUNT_TYPE.OTHER_EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.OTHER_EXPENSE,
    allowManualPosting: false
  }),
  defaultAccount({
    code: "7910",
    name: "Refunds and Allowances",
    type: GL_ACCOUNT_TYPE.OTHER_EXPENSE,
    subtype: GL_ACCOUNT_SUBTYPE.REFUNDS_AND_ALLOWANCES,
    parentCode: "7900"
  })
]);

module.exports = {
  DEFAULT_CHART_OF_ACCOUNTS
};
