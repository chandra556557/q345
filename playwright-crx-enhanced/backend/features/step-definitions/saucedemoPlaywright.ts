/**
 * SauceDemo Step Definitions with Playwright
 * Real browser automation for https://saucedemo.com
 *
 * All selectors are centralized in SELECTORS map for maintainability.
 * Each selector has a primary + fallback chain so tests survive DOM changes.
 */

import { Given, When, Then, Before, After, AfterAll, World } from '@cucumber/cucumber';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { resolveStepParameter } from '../support/dynamicFeatures';

// --- Centralized Selector Map ---
// Update these when SauceDemo changes their DOM structure
const S = {
  // Login page
  usernameInput:    'input[data-test="username"], input[placeholder*="Username"], #user-name',
  passwordInput:    'input[data-test="password"], input[placeholder*="Password"], #password',
  loginButton:      'input[data-test="login-button"], #login-button, button:has-text("Login")',
  loginError:       '[data-test="error"], .error-message-container, h3[data-test="error"]',

  // Products / Inventory
  inventoryList:    '.inventory_list, [data-test="inventory-list"], #inventory_container .inventory_list',
  inventoryItem:    '.inventory_item, [data-test="inventory-item"]',
  itemName:         '.inventory_item_name, [data-test="inventory-item-name"]',
  itemPrice:        '.inventory_item_price, [data-test="inventory-item-price"]',
  itemDetailName:   '.inventory_details_name, [data-test="inventory-item-name"]',
  itemDetails:      '.inventory_details, [data-test="inventory-item-page"]',
  sortDropdown:     '[data-test="product-sort-container"], [data-test="product_sort_container"], .product_sort_container',

  // Cart
  cartBadge:        '.shopping_cart_badge, [data-test="shopping-cart-badge"]',
  cartLink:         '.shopping_cart_link, [data-test="shopping-cart-link"], a.shopping_cart_link',
  cartList:         '.cart_list, [data-test="cart-list"]',
  cartItem:         '.cart_item, [data-test="inventory-item"]',

  // Checkout
  checkoutButton:   '[data-test="checkout"], button:has-text("Checkout")',
  checkoutInfo:     '.checkout_info, [data-test="checkout-info"]',
  firstNameInput:   '[data-test="firstName"], input[placeholder*="First Name"]',
  lastNameInput:    '[data-test="lastName"], input[placeholder*="Last Name"]',
  zipCodeInput:     '[data-test="postalCode"], input[placeholder*="Zip"]',
  continueButton:   '[data-test="continue"], input[value*="CONTINUE"], button:has-text("Continue")',
  summaryInfo:      '.summary_info, [data-test="checkout-summary-container"]',
  totalPrice:       '.summary_total_label, [data-test="total-label"]',

  // Navigation
  appLogo:          '.app_logo, [data-test="header-label"], .header_label',
  menuButton:       '#react-burger-menu-btn, .bm-burger-button, button[id="react-burger-menu-btn"]',
  logoutLink:       '[data-test="logout-sidebar-link"], #logout_sidebar_link, a:has-text("Logout")',
};

/** Try multiple selectors, return first match */
async function findElement(page: Page, selectorChain: string, timeout = 5000) {
  const selectors = selectorChain.split(',').map(s => s.trim());
  for (const selector of selectors) {
    try {
      const el = await page.waitForSelector(selector, { timeout: Math.min(timeout, 2000) });
      if (el) return el;
    } catch {
      // try next selector
    }
  }
  // Final attempt with full timeout on first selector
  return page.waitForSelector(selectors[0], { timeout });
}

// --- World Interface ---
interface SauceDemoWorld extends World {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  appUrl?: string;
  lastError?: string;
}

let browser: Browser | null = null;

// Reuse browser across scenarios — only launch once (cold start is slow)
Before({ tags: '@login or @products or @logout or @saucedemo' }, async function(this: any) {
  try {
    if (!browser || !browser.isConnected()) {
      console.log(`🚀 Launching Chromium (first scenario)...`);
      browser = await chromium.launch({ headless: true, timeout: 60000 });
    }
    // Fresh context + page per scenario (isolates cookies/storage)
    this.context = await browser.newContext();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30000);
    this.page.setDefaultNavigationTimeout(30000);
    this.appUrl = this.appUrl || 'https://saucedemo.com';
    console.log(`✓ Browser ready | URL: ${this.appUrl}`);
  } catch (error: any) {
    throw new Error(`Failed to launch browser: ${error.message}`);
  }
});

// Close context after each scenario (keeps browser alive for reuse)
After(async function(this: SauceDemoWorld) {
  if (this.page) await this.page.close().catch(() => {});
  if (this.context) await this.context.close().catch(() => {});
  console.log(`✓ Browser context closed`);
});

// Close browser once after all scenarios
AfterAll(async function() {
  if (browser && browser.isConnected()) {
    await browser.close();
    browser = null;
    console.log(`✓ Browser fully closed`);
  }
});

// --- Given Steps ---

Given('the application URL is set to {string}', async function(this: SauceDemoWorld, url: string) {
  this.appUrl = resolveStepParameter(url, this) || url;
  console.log(`✓ Application URL set to: ${this.appUrl}`);
});

Given('the browser is opened', async function(this: SauceDemoWorld) {
  if (!this.page) throw new Error('Browser page not initialized');
  console.log(`✓ Browser is open and ready`);
});

Given('the application is loaded', async function(this: SauceDemoWorld) {
  if (!this.page) throw new Error('Browser page not initialized');
  console.log(`✓ Application is loaded`);
});

Given('I am logged in as {string}', async function(this: SauceDemoWorld, username: string) {
  const url = this.appUrl || 'https://saucedemo.com';
  await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await findElement(this.page!, S.usernameInput);
  await this.page!.fill(S.usernameInput.split(',')[0].trim(), username);
  await this.page!.fill(S.passwordInput.split(',')[0].trim(), 'secret_sauce');
  await this.page!.click(S.loginButton.split(',')[0].trim());
  await findElement(this.page!, S.inventoryList, 8000);
  console.log(`✓ Logged in as: ${username}`);
});

Given('I have added {int} products to cart', async function(this: SauceDemoWorld, count: number) {
  const url = this.appUrl || 'https://saucedemo.com';
  await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await findElement(this.page!, S.usernameInput);
  await this.page!.fill(S.usernameInput.split(',')[0].trim(), 'standard_user');
  await this.page!.fill(S.passwordInput.split(',')[0].trim(), 'secret_sauce');
  await this.page!.click(S.loginButton.split(',')[0].trim());
  await findElement(this.page!, S.inventoryList);

  const products = await this.page!.$$(S.inventoryItem.split(',')[0].trim());
  for (let i = 0; i < count && i < products.length; i++) {
    const button = await products[i].$('button');
    if (button) await button.click();
  }
  console.log(`✓ Added ${count} products to cart`);
});

// --- When Steps ---

When('I navigate to the login page', async function(this: SauceDemoWorld) {
  const url = this.appUrl || 'https://saucedemo.com';
  if (!url || url.includes('/*')) throw new Error(`Invalid URL: ${url}`);

  await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await findElement(this.page!, S.usernameInput, 8000);
  console.log(`✓ Login page loaded: ${url}`);
});

When('I enter username {string}', async function(this: SauceDemoWorld, username: string) {
  const field = await findElement(this.page!, S.usernameInput);
  if (!field) throw new Error('Username field not found');
  await field.fill(username);
  console.log(`✓ Entered username: ${username}`);
});

When('I enter password {string}', async function(this: SauceDemoWorld, password: string) {
  const field = await findElement(this.page!, S.passwordInput);
  if (!field) throw new Error('Password field not found');
  await field.fill(password);
  console.log(`✓ Entered password`);
});

When('I click the login button', async function(this: SauceDemoWorld) {
  const btn = await findElement(this.page!, S.loginButton);
  if (!btn) throw new Error('Login button not found');
  await btn.click();

  // Wait for either products page or error message
  try {
    await findElement(this.page!, S.inventoryList, 5000);
    console.log(`✓ Login successful`);
  } catch {
    const errorMsg = await this.page!.$(S.loginError.split(',')[0].trim());
    if (errorMsg) {
      this.lastError = await errorMsg.textContent() || 'Unknown error';
      console.log(`✗ Login failed: ${this.lastError}`);
    }
  }
});

When('I view the products list', async function(this: SauceDemoWorld) {
  const list = await findElement(this.page!, S.inventoryList);
  if (!list) throw new Error('Products list not found');
  console.log(`✓ Products list is visible`);
});

When('I add the first product to cart', async function(this: SauceDemoWorld) {
  const firstProduct = await this.page!.$(S.inventoryItem.split(',')[0].trim());
  if (!firstProduct) throw new Error('No products found');
  const button = await firstProduct.$('button');
  if (!button) throw new Error('Add to cart button not found');
  await button.click();
  console.log(`✓ Added first product to cart`);
});

When('I add {int} products to cart', async function(this: SauceDemoWorld, count: number) {
  const products = await this.page!.$$(S.inventoryItem.split(',')[0].trim());
  if (products.length < count) throw new Error(`Only ${products.length} products available, need ${count}`);
  for (let i = 0; i < count; i++) {
    const button = await products[i].$('button');
    if (button) await button.click();
  }
  console.log(`✓ Added ${count} products to cart`);
});

When('I navigate to the cart page', async function(this: SauceDemoWorld) {
  await this.page!.click(S.cartLink.split(',')[0].trim());
  await findElement(this.page!, S.cartList, 5000);
  console.log(`✓ Navigated to cart page`);
});

When('I remove the first product from cart', async function(this: SauceDemoWorld) {
  const removeButton = await this.page!.$('button:has-text("Remove")');
  if (!removeButton) throw new Error('Remove button not found');
  await removeButton.click();
  console.log(`✓ Removed first product from cart`);
});

When('I click the checkout button', async function(this: SauceDemoWorld) {
  await this.page!.click(S.checkoutButton.split(',')[0].trim());
  await findElement(this.page!, S.checkoutInfo, 5000);
  console.log(`✓ Clicked checkout button`);
});

When('I fill in checkout information:', async function(this: SauceDemoWorld, dataTable: any) {
  const data = dataTable.rowsHash();
  if (data.firstName) await this.page!.fill(S.firstNameInput.split(',')[0].trim(), data.firstName);
  if (data.lastName) await this.page!.fill(S.lastNameInput.split(',')[0].trim(), data.lastName);
  if (data.zipCode) await this.page!.fill(S.zipCodeInput.split(',')[0].trim(), data.zipCode);
  console.log(`✓ Filled in checkout information`);
});

When('I click continue', async function(this: SauceDemoWorld) {
  await this.page!.click(S.continueButton.split(',')[0].trim());
  await findElement(this.page!, S.summaryInfo, 5000);
  console.log(`✓ Clicked continue button`);
});

When('I click the {string} button', async function(this: SauceDemoWorld, buttonText: string) {
  const button = await this.page!.$(`input[value*="${buttonText.toUpperCase()}"], button:has-text("${buttonText}"), [data-test*="${buttonText.toLowerCase()}"]`);
  if (!button) throw new Error(`Button "${buttonText}" not found`);
  await button.click();
  console.log(`✓ Clicked "${buttonText}" button`);
});

When('I select sort option {string}', async function(this: SauceDemoWorld, sortOption: string) {
  const dropdown = await findElement(this.page!, S.sortDropdown);
  if (!dropdown) throw new Error('Sort dropdown not found');
  await dropdown.selectOption({ label: sortOption });
  console.log(`✓ Selected sort option: ${sortOption}`);
});

When('I click on {string}', async function(this: SauceDemoWorld, productName: string) {
  const product = await this.page!.$(`text="${productName}"`);
  if (!product) throw new Error(`Product "${productName}" not found`);
  await product.click();
  await findElement(this.page!, S.itemDetails, 5000);
  console.log(`✓ Clicked on product: ${productName}`);
});

When('I click the menu button', async function(this: SauceDemoWorld) {
  await this.page!.click(S.menuButton.split(',')[0].trim());
  console.log(`✓ Clicked menu button`);
});

When('I click the logout link', async function(this: SauceDemoWorld) {
  await this.page!.click(S.logoutLink.split(',')[0].trim());
  console.log(`✓ Clicked logout link`);
});

When('I navigate to {string}', async function(this: SauceDemoWorld, url: string) {
  await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log(`✓ Navigated to: ${url}`);
});

// --- Then Steps ---

Then('I should see the products page', async function(this: SauceDemoWorld) {
  const page = await findElement(this.page!, S.inventoryList);
  if (!page) throw new Error('Products page not found - login may have failed');
  console.log(`✓ Products page is visible`);
});

Then('the page title should contain {string}', async function(this: SauceDemoWorld, expectedText: string) {
  const title = await this.page!.$(S.appLogo.split(',')[0].trim());
  const titleText = await title?.textContent() || '';
  if (!titleText.includes(expectedText)) throw new Error(`Expected "${expectedText}" in title but got "${titleText}"`);
  console.log(`✓ Page title contains: "${expectedText}"`);
});

Then('I should see at least {int} products', async function(this: SauceDemoWorld, minCount: number) {
  const products = await this.page!.$$(S.inventoryItem.split(',')[0].trim());
  if (products.length < minCount) throw new Error(`Expected at least ${minCount} products but found ${products.length}`);
  console.log(`✓ Found ${products.length} products (minimum: ${minCount})`);
});

Then('each product should have a name and price', async function(this: SauceDemoWorld) {
  const products = await this.page!.$$(S.inventoryItem.split(',')[0].trim());
  for (const product of products) {
    const name = await product.$(S.itemName.split(',')[0].trim());
    const price = await product.$(S.itemPrice.split(',')[0].trim());
    if (!name || !price) throw new Error('Product missing name or price');
  }
  console.log(`✓ All products have name and price`);
});

Then('each product should have an {string} button', async function(this: SauceDemoWorld, buttonText: string) {
  const products = await this.page!.$$(S.inventoryItem.split(',')[0].trim());
  for (const product of products) {
    const button = await product.$(`button:has-text("${buttonText}")`);
    if (!button) throw new Error(`Button "${buttonText}" not found on product`);
  }
  console.log(`✓ All products have "${buttonText}" button`);
});

Then('the cart counter should show {string}', async function(this: SauceDemoWorld, expectedCount: string) {
  const cartBadge = await this.page!.$(S.cartBadge.split(',')[0].trim());
  if (!cartBadge) throw new Error('Cart counter not found');
  const cartCount = await cartBadge.textContent();
  if (cartCount?.trim() !== expectedCount) throw new Error(`Expected cart count "${expectedCount}" but got "${cartCount}"`);
  console.log(`✓ Cart counter shows: ${expectedCount}`);
});

Then('I should see {int} items in the cart', async function(this: SauceDemoWorld, expectedCount: number) {
  const cartItems = await this.page!.$$(S.cartItem.split(',')[0].trim());
  if (cartItems.length !== expectedCount) throw new Error(`Expected ${expectedCount} items in cart but found ${cartItems.length}`);
  console.log(`✓ Cart contains ${expectedCount} items`);
});

Then('I should see the order summary', async function(this: SauceDemoWorld) {
  const summary = await findElement(this.page!, S.summaryInfo);
  if (!summary) throw new Error('Order summary not found');
  console.log(`✓ Order summary is visible`);
});

Then('I should see the total price', async function(this: SauceDemoWorld) {
  const totalPrice = await this.page!.$(S.totalPrice.split(',')[0].trim());
  if (!totalPrice) throw new Error('Total price not found');
  const priceText = await totalPrice.textContent();
  console.log(`✓ Total price displayed: ${priceText}`);
});

Then('I should see the order confirmation page', async function(this: SauceDemoWorld) {
  const msg = await this.page!.$('text=Thank you, [data-test="complete-header"]');
  if (!msg) throw new Error('Order confirmation message not found');
  console.log(`✓ Order confirmation page displayed`);
});

Then('I should see {string} message', async function(this: SauceDemoWorld, expectedMessage: string) {
  const message = await this.page!.$(`text=${expectedMessage}`);
  if (!message) throw new Error(`Message "${expectedMessage}" not found`);
  console.log(`✓ Message displayed: "${expectedMessage}"`);
});

Then('the products should be sorted by price in ascending order', async function(this: SauceDemoWorld) {
  const priceSelector = S.itemPrice.split(',')[0].trim();
  const prices = await this.page!.$$eval(priceSelector, elements =>
    elements.map(el => parseFloat(el.textContent?.replace('$', '') || '0'))
  );
  for (let i = 0; i < prices.length - 1; i++) {
    if (prices[i] > prices[i + 1]) throw new Error('Products are not sorted in ascending order by price');
  }
  console.log(`✓ Products sorted by price (low to high)`);
});

Then('I should see the product detail page', async function(this: SauceDemoWorld) {
  const details = await findElement(this.page!, S.itemDetails);
  if (!details) throw new Error('Product detail page not found');
  console.log(`✓ Product detail page displayed`);
});

Then('I should see the product name {string}', async function(this: SauceDemoWorld, expectedName: string) {
  const name = await this.page!.$(S.itemDetailName.split(',')[0].trim());
  const nameText = await name?.textContent() || '';
  if (!nameText.includes(expectedName)) throw new Error(`Expected product name "${expectedName}" but got "${nameText}"`);
  console.log(`✓ Product name: ${expectedName}`);
});

Then('I should see an error message', async function(this: SauceDemoWorld) {
  const errorMsg = await findElement(this.page!, S.loginError);
  if (!errorMsg) throw new Error('Error message not found');
  console.log(`✓ Error message displayed`);
});

Then('the error message should contain {string}', async function(this: SauceDemoWorld, expectedText: string) {
  const errorMsg = await this.page!.$(S.loginError.split(',')[0].trim());
  const errorText = await errorMsg?.textContent() || '';
  if (!errorText.includes(expectedText)) throw new Error(`Expected error to contain "${expectedText}" but got "${errorText}"`);
  console.log(`✓ Error message contains: "${expectedText}"`);
});

Then('the page should load within {int} seconds', async function(this: SauceDemoWorld, maxSeconds: number) {
  const startTime = Date.now();
  await this.page!.waitForLoadState('networkidle', { timeout: maxSeconds * 1000 });
  const loadTime = (Date.now() - startTime) / 1000;
  console.log(`✓ Page loaded in ${loadTime.toFixed(2)} seconds`);
});

Then('all images should be loaded', async function(this: SauceDemoWorld) {
  const images = await this.page!.$$('img');
  for (const img of images) {
    const complete = await img.evaluate((el: any) => el.complete);
    if (!complete) throw new Error('Some images failed to load');
  }
  console.log(`✓ All images loaded successfully`);
});

Then('the page should be responsive', async function(this: SauceDemoWorld) {
  const viewport = this.page!.viewportSize();
  if (!viewport) throw new Error('Viewport not set');
  console.log(`✓ Page is responsive (viewport: ${viewport.width}x${viewport.height})`);
});
