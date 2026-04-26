const config = {
  testRegex: '.e2e-spec.js$',
  rootDir: '.',
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  moduleFileExtensions: ['js', 'json'],
};

module.exports = config;
