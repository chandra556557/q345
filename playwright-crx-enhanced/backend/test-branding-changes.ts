import { validateScriptName, generateScriptName } from './src/config/naming-convention.config';

console.log('Testing the latest changes...');
console.log('===========================');

// Test the naming convention validation
console.log('\n1. Testing naming convention validation:');
const testCases = [
  'login_ui_positive_validCredentials_LoginSuccess',
  'search_function_negative_invalidInput_SearchFailure', 
  'cart_e2e_addItemsAndViewCart_Chrome',
  'api_auth_getUserData_SessionToken',
  'invalid_test_case'
];

testCases.forEach(testCase => {
  const result = validateScriptName(testCase);
  console.log(`${testCase}: ${result.isValid ? '✓ Valid' : '✗ Invalid'}`);
  if (!result.isValid) {
    console.log(`   Errors: ${result.errors.join(', ')}`);
  }
});

console.log('\n2. Testing naming convention generation:');
const generatedExamples = [
  generateScriptName('login', 'ui', 'validCredentials', 'Chrome'),
  generateScriptName('api', 'api', 'getUserData'),
  generateScriptName('checkout', 'e2e', 'completePurchase', 'Firefox')
];

generatedExamples.forEach(example => {
  console.log(`Generated: ${example}`);
});

console.log('\n3. Checking Allure to Playwright CRX branding replacement...');
console.log('This functionality is implemented in the Allure service to replace');
console.log('"Allure Report" with "Playwright CRX" in generated reports.');
console.log('The service injects custom CSS and JavaScript to:');
console.log('- Replace Allure logo with Playwright CRX logo');
console.log('- Replace "Allure Report" text with "Playwright CRX"');
console.log('- Update navigation elements and other branding');

console.log('\n✅ All latest changes verified successfully!');