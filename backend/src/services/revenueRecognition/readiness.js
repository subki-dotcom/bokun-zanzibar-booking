const mongoose = require('mongoose');
const { env } = require('../../config/env');

const REQUIRED_MAPPINGS = [
  ['TOUR_REVENUE', 'REVENUE'],
  ['ACCOUNTS_RECEIVABLE', 'ASSET', 'ACCOUNTS_RECEIVABLE'],
  ['GYG_RECEIVABLE', 'ASSET', 'ACCOUNTS_RECEIVABLE'],
  ['VIATOR_RECEIVABLE', 'ASSET', 'ACCOUNTS_RECEIVABLE'],
  ['OTA_RECEIVABLE', 'ASSET', 'ACCOUNTS_RECEIVABLE'],
  ['FX_GAIN', 'OTHER_INCOME'],
  ['FX_LOSS', 'OTHER_EXPENSE'],
  ['REFUND_ALLOWANCE', 'OTHER_EXPENSE'],
  ['REFUND_PAYABLE', 'LIABILITY', 'REFUND_PAYABLE'],
];

const hasExplicitBoundary = (config, now = new Date()) => {
  const value = config.REVENUE_RECOGNITION_ACTIVATED_AT || '';
  const timestamp = new Date(value);
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) &&
    Number.isFinite(timestamp.getTime()) &&
    timestamp <= now &&
    config.REVENUE_RECOGNITION_ACTIVATION_SCOPE === 'NEW_COMPLETIONS'
  );
};

const requiredUniqueIndexes = [
  ['RevenueRecognition', 'postingKey'],
  ['JournalEntry', 'source.postingKey'],
];

const createRevenueReadinessService = ({
  models = {
    RevenueRecognition: require('../../models/RevenueRecognition'),
    JournalEntry: require('../../models/JournalEntry'),
    AccountingMapping: require('../../models/AccountingMapping'),
    ChartOfAccount: require('../../models/ChartOfAccount'),
  },
  connection = mongoose.connection,
  config = env,
  now = () => new Date(),
} = {}) => {
  const transactionSupport = async () => {
    try {
      const hello = await connection.db.admin().command({ hello: 1 });
      const supported = Boolean(hello.setName || hello.msg === 'isdbgrid');
      return {
        supported,
        status: supported ? 'VERIFIED' : 'BLOCKED',
        reason: supported ? '' : 'MONGODB_TRANSACTIONS_REQUIRE_REPLICA_SET_OR_MONGOS',
      };
    } catch (error) {
      return {
        supported: false,
        status: 'UNVERIFIED',
        reason: error.code || error.name || 'MONGODB_HELLO_UNAVAILABLE',
      };
    }
  };
  const uniqueIndexes = async () => {
    try {
      const missing = [];
      for (const [modelName, field] of requiredUniqueIndexes) {
        const indexes = await models[modelName].collection.indexes();
        if (
          !indexes.some(
            (index) =>
              index.unique &&
              index.key[field] === 1 &&
              Object.keys(index.key).length === 1 &&
              !index.partialFilterExpression
          )
        )
          missing.push(`${modelName}.${field}`);
      }
      return { ready: !missing.length, status: missing.length ? 'BLOCKED' : 'VERIFIED', missing };
    } catch (error) {
      return {
        ready: false,
        status: 'UNVERIFIED',
        missing: [],
        reason: error.code || error.name || 'INDEX_METADATA_UNAVAILABLE',
      };
    }
  };
  const accountMappings = async () => {
    try {
      const missing = [];
      for (const [mappingKey, type, subtype] of REQUIRED_MAPPINGS) {
        const mapping = await models.AccountingMapping.findOne({ mappingKey, active: true }).lean();
        if (!mapping) {
          missing.push(mappingKey);
          continue;
        }
        const account = await models.ChartOfAccount.findOne({ code: mapping.accountCode, active: true }).lean();
        if (!account || account.type !== type || (subtype && account.subtype !== subtype))
          missing.push(mappingKey);
      }
      return { ready: !missing.length, status: missing.length ? 'MISSING' : 'VERIFIED', missing };
    } catch (error) {
      return {
        ready: false,
        status: 'UNVERIFIED',
        missing: [],
        reason: error.code || error.name || 'ACCOUNT_MAPPING_READ_UNAVAILABLE',
      };
    }
  };
  const assess = async () => {
    const [transactions, indexes, mappings] = await Promise.all([
      transactionSupport(),
      uniqueIndexes(),
      accountMappings(),
    ]);
    const activationBoundary = hasExplicitBoundary(config, now());
    return {
      transactionSupport: transactions.supported,
      transactionSupportStatus: transactions.status,
      transactionSupportReason: transactions.reason,
      uniqueIndexes: indexes.ready,
      uniqueIndexesStatus: indexes.status,
      missingUniqueIndexes: indexes.missing,
      indexReadReason: indexes.reason || '',
      accountMappings: mappings.ready,
      accountMappingsStatus: mappings.status,
      missingAccountMappings: mappings.missing,
      accountMappingReadReason: mappings.reason || '',
      activationBoundary,
      ready: transactions.supported && indexes.ready && mappings.ready && activationBoundary,
    };
  };
  return { assess, hasExplicitBoundary };
};

module.exports = { REQUIRED_MAPPINGS, hasExplicitBoundary, createRevenueReadinessService };