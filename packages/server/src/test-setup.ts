// Runs before each test file (vitest setupFiles). Provides a valid env + in-memory DB
// so importing modules that read env / open the database does not fail.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
process.env.SEED_ADMIN_EMAIL = 'admin@ais.local';
process.env.SEED_ADMIN_PASSWORD = 'ChangeMe123!';
