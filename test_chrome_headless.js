const { chromium } = require('playwright-core');

(async () => {
  // Launch Chrome in headless mode
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });
  
  const page = await browser.newPage();
  
  // Navigate to a test page
  await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
  
  // Take a screenshot
  await page.screenshot({ path: 'test-chrome-headless.png' });
  
  console.log('Chrome headless test completed successfully!');
  console.log('Screenshot saved as test-chrome-headless.png');
  
  await browser.close();
})();