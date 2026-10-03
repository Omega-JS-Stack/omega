// A plain script, not a suite: it requires a case file and reports what defineCases returned.
const caseFile = require('./test/case.test.js');

process.stdout.write(caseFile.exported === caseFile.spec ? 'returned:same\n' : 'returned:different\n');
