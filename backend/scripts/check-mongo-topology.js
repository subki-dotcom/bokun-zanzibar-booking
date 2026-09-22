require('dotenv').config();

const mongoose = require('mongoose');
const { env } = require('../src/config/env');

const maskMongoUri = (uri = '') =>
  String(uri || '')
    .replace(/(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@/i, '$1[redacted]:[redacted]@')
    .replace(/([?&](?:authSource|password)=)[^&]+/gi, '$1[redacted]');

const run = async () => {
  const uri = env.MONGO_URI || '';
  const isSrv = uri.startsWith('mongodb+srv://');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    const admin = mongoose.connection.db.admin();
    const hello = await admin.command({ hello: 1 });
    const buildInfo = await admin.command({ buildInfo: 1 }).catch(() => null);
    let replSetStatus = null;
    let replSetStatusError = null;
    try {
      replSetStatus = await admin.command({ replSetGetStatus: 1 });
    } catch (error) {
      replSetStatusError = error.codeName || error.message;
    }
    console.log(
      JSON.stringify(
        {
          uriScheme: isSrv ? 'mongodb+srv (Atlas/managed, always replica set)' : 'mongodb (self-hosted/direct)',
          uriMasked: maskMongoUri(uri),
          hosts: hello.hosts || (hello.me ? [hello.me] : []),
          isWritablePrimary: Boolean(hello.isWritablePrimary),
          isMongos: hello.msg === 'isdbgrid',
          setName: hello.setName || null,
          topology: hello.setName ? 'REPLICA_SET' : hello.msg === 'isdbgrid' ? 'SHARDED_MONGOS' : 'STANDALONE',
          mongoVersion: buildInfo?.version || null,
          storageEngine: buildInfo?.storageEngines || null,
          replSetStatusOk: Boolean(replSetStatus),
          replSetStatusError,
          members: replSetStatus?.members?.map((m) => ({ name: m.name, stateStr: m.stateStr, health: m.health })) || null,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(JSON.stringify({ error: error.codeName || error.message }, null, 2));
  process.exitCode = 1;
});
