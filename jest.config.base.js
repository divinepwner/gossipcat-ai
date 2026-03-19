module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }]
  },
  moduleNameMapper: {
    '^@gossip/types$': '<rootDir>/packages/types/src',
    '^@gossip/types/(.*)$': '<rootDir>/packages/types/src/$1',
    '^@gossip/relay$': '<rootDir>/packages/relay/src',
    '^@gossip/relay/(.*)$': '<rootDir>/packages/relay/src/$1',
    '^@gossip/client$': '<rootDir>/packages/client/src',
    '^@gossip/client/(.*)$': '<rootDir>/packages/client/src/$1',
    '^@gossip/tools$': '<rootDir>/packages/tools/src',
    '^@gossip/tools/(.*)$': '<rootDir>/packages/tools/src/$1',
    '^@gossip/orchestrator$': '<rootDir>/packages/orchestrator/src',
    '^@gossip/orchestrator/(.*)$': '<rootDir>/packages/orchestrator/src/$1'
  }
};
