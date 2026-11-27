const mongoose = require('mongoose');
const User = require('../../backend/src/modules/auth/userModel');

const mongoUri =
  process.env.MONGODB_URI_E2E || 'mongodb://127.0.0.1:27018/sigap_ulp_labuhan_e2e';

module.exports = async function globalTeardown() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  await User.deleteOne({ adminId: 'e2eadmin' });
  await mongoose.disconnect();
};
