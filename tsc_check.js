const ts = require(require('path').join(__dirname, 'playwright-crx-enhanced/backend/node_modules/typescript'));
const path = require('path');

const configPath = path.join(__dirname, 'playwright-crx-enhanced/backend/tsconfig.json');
const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
const basePath = path.join(__dirname, 'playwright-crx-enhanced/backend');
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, basePath);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [
  ...program.getSyntacticDiagnostics(),
  ...program.getSemanticDiagnostics()
];

const host = {
  getCanonicalFileName: f => f,
  getCurrentDirectory: () => basePath,
  getNewLine: () => '\n'
};

if (diagnostics.length === 0) {
  console.log('No TypeScript errors found.');
} else {
  console.log('Total errors: ' + diagnostics.length);
  console.log('---');
  // Show last 60 lines of formatted output
  const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, host);
  const lines = formatted.split('\n');
  const last60 = lines.slice(-60);
  last60.forEach(l => console.log(l));
}
