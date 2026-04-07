import { validateScriptName, generateScriptName } from './src/config/naming-convention.config';

console.log('Testing naming convention functionality...\n');

// Test valid script names
console.log('1. Testing valid script name:');
const validResult = validateScriptName('login_ui_positive_validCredentials_LoginSuccess');
console.log('isValid:', validResult.isValid);
console.log('errors:', validResult.errors);
console.log();

// Test invalid script name
console.log('2. Testing invalid script name:');
const invalidResult = validateScriptName('invalid_script_name');
console.log('isValid:', invalidResult.isValid);
console.log('errors:', invalidResult.errors);
console.log();

// Test generating a script name
console.log('3. Generating script name:');
const generatedName = generateScriptName('search', 'ui', 'invalidInput', 'Chrome');
console.log('Generated name:', generatedName);
console.log();

// Test another valid example
console.log('4. Testing another valid script name:');
const anotherValidResult = validateScriptName('api_auth_getUserData_SessionToken');
console.log('isValid:', anotherValidResult.isValid);
console.log('errors:', anotherValidResult.errors);
console.log();

console.log('Naming convention tests completed!');