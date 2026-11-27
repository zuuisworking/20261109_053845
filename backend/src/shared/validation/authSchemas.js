const ADMIN_ROLES = Object.freeze(['superadmin', 'admin']);

const adminIdSchema = {
  type: 'string',
  minLength: 3,
  maxLength: 64,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
};

const usernameSchema = {
  type: 'string',
  minLength: 3,
  maxLength: 64,
  pattern: '.*\\S.*',
};

const passwordSchema = {
  type: 'string',
  minLength: 8,
  maxLength: 128,
  pattern: '^\\S+$',
  allOf: [
    { pattern: '[a-z]' },
    { pattern: '[A-Z]' },
    { pattern: '[0-9]' },
  ],
};

const nullableEmailSchema = {
  anyOf: [
    {
      type: 'string',
      format: 'email',
      maxLength: 254,
    },
    { type: 'null' },
  ],
};

const nullableFullNameSchema = {
  anyOf: [
    {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      pattern: '.*\\S.*',
    },
    { type: 'null' },
  ],
};

const roleSchema = {
  type: 'string',
  enum: ADMIN_ROLES,
};

const loginSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    adminId: adminIdSchema,
    idadmin: adminIdSchema,
    password: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
    },
  },
  anyOf: [
    { required: ['adminId'] },
    { required: ['idadmin'] },
  ],
  required: ['password'],
};

const registerAdminSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['adminId', 'username', 'password'],
  properties: {
    adminId: adminIdSchema,
    username: usernameSchema,
    password: passwordSchema,
    fullName: nullableFullNameSchema,
    email: nullableEmailSchema,
    role: {
      type: 'string',
      enum: ['admin'],
    },
  },
};

const usernameChangeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    username: usernameSchema,
    newUsername: usernameSchema,
  },
  anyOf: [
    { required: ['username'] },
    { required: ['newUsername'] },
  ],
};

const passwordChangeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    currentPassword: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
    },
    oldPassword: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
    },
    newPassword: passwordSchema,
  },
  required: ['newPassword'],
  anyOf: [
    { required: ['currentPassword'] },
    { required: ['oldPassword'] },
  ],
};

const profileSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    fullName: nullableFullNameSchema,
    email: nullableEmailSchema,
  },
};

module.exports = {
  ADMIN_ROLES,
  adminIdSchema,
  usernameSchema,
  passwordSchema,
  nullableEmailSchema,
  nullableFullNameSchema,
  roleSchema,
  loginSchema,
  registerAdminSchema,
  usernameChangeSchema,
  passwordChangeSchema,
  profileSchema,
};
