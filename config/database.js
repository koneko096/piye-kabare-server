module.exports = {
  url: process.env.MONGODB_URL || "mongodb://localhost:27017/pat",
  testUrl: process.env.MONGODB_TEST_URL || "mongodb://localhost:27017/testPat",
};
