const {
  GL_MAPPING_KEY,
  GL_POSTING_TYPE,
  SOURCE_MODULE
} = require("./constants");

const DEFAULT_ACCOUNTING_MAPPINGS = Object.freeze([
  { mappingKey: GL_MAPPING_KEY.CASH, accountCode: "1010", description: "Default cash account" },
  { mappingKey: GL_MAPPING_KEY.BANK, accountCode: "1020", description: "Default operating bank account" },
  { mappingKey: GL_MAPPING_KEY.PESAPAL_CLEARING, accountCode: "1030", provider: "pesapal", description: "Pesapal provider clearing" },
  { mappingKey: GL_MAPPING_KEY.PAYPAL_CLEARING, accountCode: "1040", provider: "paypal", description: "PayPal provider clearing" },
  { mappingKey: GL_MAPPING_KEY.DPO_CLEARING, accountCode: "1050", provider: "dpo", description: "DPO provider clearing" },
  { mappingKey: GL_MAPPING_KEY.MOBILE_MONEY, accountCode: "1060", description: "Mobile money account" },
  { mappingKey: GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE, accountCode: "1100", description: "Accounts receivable control account" },
  { mappingKey: GL_MAPPING_KEY.ACCOUNTS_PAYABLE, accountCode: "2010", description: "Accounts payable control account" },
  { mappingKey: GL_MAPPING_KEY.REFUND_PAYABLE, accountCode: "2040", description: "Refund payable control account" },
  { mappingKey: GL_MAPPING_KEY.TAX_PAYABLE, accountCode: "2100", description: "Tax payable account" },
  { mappingKey: GL_MAPPING_KEY.OWNER_CAPITAL, accountCode: "3010", description: "Owner capital" },
  { mappingKey: GL_MAPPING_KEY.RETAINED_EARNINGS, accountCode: "3020", description: "Retained earnings" },
  { mappingKey: GL_MAPPING_KEY.OWNER_DRAWING, accountCode: "3030", description: "Owner drawings" },
  { mappingKey: GL_MAPPING_KEY.TOUR_REVENUE, accountCode: "4010", description: "Tour revenue" },
  { mappingKey: GL_MAPPING_KEY.TRANSFER_REVENUE, accountCode: "4020", description: "Transfer revenue" },
  { mappingKey: GL_MAPPING_KEY.OTHER_SERVICE_REVENUE, accountCode: "4040", description: "Other service revenue" },
  { mappingKey: GL_MAPPING_KEY.SUPPLIER_DIRECT_COST, accountCode: "5010", description: "Supplier direct cost" },
  { mappingKey: GL_MAPPING_KEY.TRANSPORT_DIRECT_COST, accountCode: "5020", description: "Transport direct cost" },
  { mappingKey: GL_MAPPING_KEY.GUIDE_DIRECT_COST, accountCode: "5030", description: "Guide direct cost" },
  { mappingKey: GL_MAPPING_KEY.BOAT_DIRECT_COST, accountCode: "5040", description: "Boat direct cost" },
  { mappingKey: GL_MAPPING_KEY.SALARY_EXPENSE, accountCode: "6010", description: "Salary expense" },
  { mappingKey: GL_MAPPING_KEY.RENT_EXPENSE, accountCode: "6020", description: "Rent expense" },
  { mappingKey: GL_MAPPING_KEY.MARKETING_EXPENSE, accountCode: "6030", description: "Marketing expense" },
  { mappingKey: GL_MAPPING_KEY.SOFTWARE_EXPENSE, accountCode: "6040", description: "Software expense" },
  { mappingKey: GL_MAPPING_KEY.PAYMENT_PROVIDER_FEE, accountCode: "6060", description: "Payment provider fee expense" },
  { mappingKey: GL_MAPPING_KEY.OTHER_INCOME, accountCode: "7010", description: "Other income" },
  { mappingKey: GL_MAPPING_KEY.REFUND_ALLOWANCE, accountCode: "7910", description: "Refunds and allowances" },
  { mappingKey: GL_MAPPING_KEY.ACCUMULATED_DEPRECIATION, accountCode: "1590", description: "Accumulated depreciation" },
  { mappingKey: GL_MAPPING_KEY.DEPRECIATION_EXPENSE, accountCode: "6080", description: "Depreciation and office expense default" }
]);

const DEFAULT_POSTING_RULES = Object.freeze([
  {
    eventType: GL_POSTING_TYPE.CUSTOMER_INVOICE,
    sourceModule: SOURCE_MODULE.INVOICE,
    debitAccountRule: GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE,
    creditAccountRule: GL_MAPPING_KEY.TOUR_REVENUE,
    descriptionTemplate: "Invoice revenue recognized for {{sourceReference}}"
  },
  {
    eventType: GL_POSTING_TYPE.CUSTOMER_PAYMENT,
    sourceModule: SOURCE_MODULE.PAYMENT,
    debitAccountRule: "{{provider}}_CLEARING",
    creditAccountRule: GL_MAPPING_KEY.ACCOUNTS_RECEIVABLE,
    descriptionTemplate: "Customer payment collected for {{sourceReference}}"
  },
  {
    eventType: GL_POSTING_TYPE.REFUND_APPROVAL,
    sourceModule: SOURCE_MODULE.REFUND,
    debitAccountRule: GL_MAPPING_KEY.REFUND_ALLOWANCE,
    creditAccountRule: GL_MAPPING_KEY.REFUND_PAYABLE,
    descriptionTemplate: "Refund liability approved for {{sourceReference}}"
  },
  {
    eventType: GL_POSTING_TYPE.REFUND_COMPLETION,
    sourceModule: SOURCE_MODULE.REFUND,
    debitAccountRule: GL_MAPPING_KEY.REFUND_PAYABLE,
    creditAccountRule: "{{provider}}_CLEARING",
    descriptionTemplate: "Refund completed for {{sourceReference}}"
  },
  {
    eventType: GL_POSTING_TYPE.BUSINESS_EXPENSE,
    sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
    debitAccountRule: "{{expenseCategory}}",
    creditAccountRule: GL_MAPPING_KEY.ACCOUNTS_PAYABLE,
    descriptionTemplate: "Business expense accrued for {{sourceReference}}"
  },
  {
    eventType: GL_POSTING_TYPE.BUSINESS_INCOME,
    sourceModule: SOURCE_MODULE.BUSINESS_ACCOUNTING,
    debitAccountRule: GL_MAPPING_KEY.BANK,
    creditAccountRule: GL_MAPPING_KEY.OTHER_INCOME,
    descriptionTemplate: "Business income recognized for {{sourceReference}}"
  }
]);

module.exports = {
  DEFAULT_ACCOUNTING_MAPPINGS,
  DEFAULT_POSTING_RULES
};
