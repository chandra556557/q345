const { chromium } = require('playwright-core');

async function testPlaywright() {
  console.log('Testing Playwright setup...');
  
  try {
    console.log('Launching browser...');
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    console.log('Browser launched successfully!');
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('Navigating to example page...');
    await page.goto('https://example.com', { waitUntil: 'networkidle' });
    
    console.log('Page loaded successfully!');
    console.log('Title:', await page.title());
    
    await browser.close();
    console.log('Browser closed successfully!');
    
    console.log('Playwright setup is working correctly!');
  } catch (error) {
    console.error('Playwright setup failed:', error.message);
    process.exit(1);
  }
}

testPlaywright();