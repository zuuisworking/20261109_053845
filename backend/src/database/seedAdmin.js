const { connectDatabase, disconnectDatabase } = require('./connection');
const User = require('../modules/auth/userModel');
const {
  adminIdSchema,
  assertValid,
  passwordSchema,
  usernameSchema,
} = require('../shared/validation');

async function seedAdmin() {
  const adminId = String(process.env.INITIAL_ADMIN_ID || '').trim().toLowerCase();
  const username = String(process.env.INITIAL_ADMIN_USERNAME || '').trim();
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '');
  const email = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase() || null;

  if (!adminId || !username || !password) {
    throw new Error(
      'INITIAL_ADMIN_ID, INITIAL_ADMIN_USERNAME, and INITIAL_ADMIN_PASSWORD are required for initial provisioning.'
    );
  }

  assertValid(adminIdSchema, adminId);
  assertValid(usernameSchema, username);
  assertValid(passwordSchema, password);

  await connectDatabase();

  try {
    const existing = await User.findOne({ adminId });
    if (existing) {
      console.log(`[Seed] Superadmin account '${adminId}' already exists; no changes were made.`);
      return;
    }

    const passwordHash = await User.hashPassword(password);
    await User.create({
      adminId,
      username,
      passwordHash,
      fullName: username,
      email,
      role: 'superadmin',
      isActive: true,
    });
    console.log(`[Seed] Superadmin account '${adminId}' was provisioned successfully.`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  seedAdmin().catch((error) => {
    console.error('[Seed Error]:', error.message);
    process.exit(1);
  });
}

module.exports = seedAdmin;
