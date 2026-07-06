require("dotenv").config();

const mongoose = require("mongoose");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const bookings = mongoose.connection.collection("bookings");
  const indexes = await bookings.indexes();

  for (const name of ["paymentTransactionId_1", "dpoTransactionToken_1"]) {
    if (indexes.some((index) => index.name === name)) {
      await bookings.dropIndex(name).catch(() => {});
    }
  }

  await bookings.createIndex(
    { paymentTransactionId: 1 },
    {
      unique: true,
      partialFilterExpression: { paymentTransactionId: { $type: "string" } },
      name: "paymentTransactionId_1"
    }
  );

  await bookings.createIndex(
    { dpoTransactionToken: 1 },
    {
      unique: true,
      partialFilterExpression: { dpoTransactionToken: { $type: "string" } },
      name: "dpoTransactionToken_1"
    }
  );

  const updatedIndexes = await bookings.indexes();
  console.log(
    JSON.stringify(
      updatedIndexes.filter((index) =>
        ["paymentTransactionId_1", "dpoTransactionToken_1"].includes(index.name)
      ),
      null,
      2
    )
  );

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
