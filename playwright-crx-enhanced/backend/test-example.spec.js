const { chromium } = require('playwright');

async function runExampleTest() {
  console.log('🚀 Starting Playwright test execution...');
  
  let browser;
  try {
    // Launch browser
    console.log('🔧 Launching Chromium browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox']
    });
    
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    
    const page = await context.newPage();
    
    // Navigate to example site
    console.log('🌐 Navigating to example.com...');
    await page.goto('https://example.com', { waitUntil: 'networkidle' });
    
    // Get page title
    const title = await page.title();
    console.log('📄 Page title:', title);
    
    // Take screenshot
    console.log('📸 Taking screenshot...');
    await page.screenshot({ path: 'example-test.png' });
    
    // Test basic interaction
    console.log('🖱️ Testing basic interaction...');
    const heading = await page.locator('h1').textContent();
    console.log('📝 Heading text:', heading);
    
    console.log('✅ Test completed successfully!');
    console.log('📁 Screenshot saved as: example-test.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔒 Browser closed');
    }
  }
}

// Execute the test
runExampleTest().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});