module.exports = {
  rootDir: 'src',
  testRegex: '.*\\.spec\\.js$',
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  collectCoverageFrom: [
    '**/*.js',
    '!main.js',
  ],
  coverageDirectory: '../coverage',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.js'],
};
