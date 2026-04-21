module.exports = {
  testEnvironment: 'node',
  testTimeout: 15000,
  projects: [
    {
      displayName: 'unit',
      testMatch: ['**/tests/unit/**/*.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName: 'integration',
      testMatch: ['**/tests/integration/**/*.test.js'],
      testEnvironment: 'node',
    },
  ],
};
