const { chromium } = require('playwright-core');

(async () => {
  console.log('🧪 Starting Chrome headless test with multiple scenarios...');
  
  // Launch Chrome in headless mode
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });
  
  const page = await browser.newPage();
  
  // Set viewport size
  await page.setViewportSize({ width: 1920, height: 1080 });
  
  console.log('🌐 Navigating to Google...');
  await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Check if page loaded
  const title = await page.title();
  console.log(`📋 Page title: ${title}`);
  
  // Take a screenshot
  await page.screenshot({ path: 'chrome-test-homepage.png' });
  console.log('📸 Screenshot saved as chrome-test-homepage.png');
  
  // Type in search box (if it exists)
  try {
    await page.fill('textarea[name=q]', 'Playwright Chrome headless test');
    console.log('⌨️  Typed in search box');
    
    // Take another screenshot
    await page.screenshot({ path: 'chrome-test-search.png' });
    console.log('📸 Screenshot saved as chrome-test-search.png');
  } catch (error) {
    console.log('🔍 Search box not found, continuing...');
  }
  
  console.log('✅ Chrome headless test completed successfully!');
  
  await browser.close();
  console.log('🔒 Browser closed');
})();