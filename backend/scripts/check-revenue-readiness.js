require('dotenv').config();

const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { createRevenueReadinessService } = require('../src/services/revenueRecognition/readiness');

const run = async () => {
  await mongoose.connect(env.MONGO_URI, { autoIndex: false });
  try {
    const readiness = await createRevenueReadinessService().assess();
    console.log(JSON.stringify({ autoPostReady: readiness.ready, ...readiness }, null, 2));
    process.exitCode = readiness.ready ? 0 : 2;
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(JSON.stringify({ autoPostReady: false, error: error.message }, null, 2));
  process.exitCode = 2;
});