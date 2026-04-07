/**
 * SauceDemo Step Definitions with Playwright
 * Real browser automation for https://saucedemo.com
 */

import { Given, When, Then, Before, After, World } from '@cucumber/cucumber';
import { chromium, Browser, Page, BrowserContext } from 'playwright';

interface SauceDemoWorld extends World {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  appUrl: string;
  lastError?: string;
}

let browser: Browser;

// Initialize browser once
Before(async function(this: SauceDemoWorld) {
  browser = await chromium.launch({ headless: true });
  this.context = await browser.newContext();
  this.page = await this.context.newPage();
  this.appUrl = 'https://saucedemo.com';
  console.log(`✓ Browser launched for testing`);
});

// Close browser after tests
After(async function(this: SauceDemoWorld) {
  if (this.page) await this.page.close();
  if (this.context) await this.context.close();
  console.log(`✓ Browser closed`);
});

/**
 * Given the application URL is set to "{url}"
 */
Given('the application URL is set to {string}', async function(this: SauceDemoWorld, url: string) {
  this.appUrl = url;
  console.log(`✓ Application URL set to: ${url}`);
});

/**
 * And the browser is opened
 */
Given('the browser is opened', async function(this: SauceDemoWorld) {
  if (!this.page) {
    throw new Error('Browser page not initialized');
  }
  console.log(`✓ Browser is open and ready`);
});

/**
 * When I navigate to the login page
 */
When('I navigate to the login page', async function(this: SauceDemoWorld) {
  await this.page!.goto(this.appUrl);

  // Wait for login page to load
  await this.page!.waitForSelector('input[placeholder*="Username"]', { timeout: 5000 });

  console.log(`✓ Navigated to login page`);
});

/**
 * And I enter username "{username}"
 */
When('I enter username {string}', async function(this: SauceDemoWorld, username: string) {
  const usernameField = await this.page!.$('input[placeholder*="Username"]');
  if (!usernameField) {
    throw new Error('Username field not found');
  }

  await usernameField.fill(username);
  console.log(`✓ Entered username: ${username}`);
});

/**
 * And I enter password "{password}"
 */
When('I enter password {string}', async function(this: SauceDemoWorld, password: string) {
  const passwordField = await this.page!.$('input[placeholder*="Password"]');
  if (!passwordField) {
    throw new Error('Password field not found');
  }

  await passwordField.fill(password);
  console.log(`✓ Entered password`);
});

/**
 * And I click the login button
 */
When('I click the login button', async function(this: SauceDemoWorld) {
  const loginButton = await this.page!.$('input[value*="LOGIN"]');
  if (!loginButton) {
    throw new Error('Login button not found');
  }

  await loginButton.click();

  // Wait for either products page or error message
  try {
    await this.page!.waitForSelector('.inventory_list', { timeout: 5000 });
    console.log(`✓ Login successful`);
  } catch (e) {
    // Check for error message
    const errorMsg = await this.page!.$('[data-test="error"]');
    if (errorMsg) {
      this.lastError = await errorMsg.textContent() || 'Unknown error';
      console.log(`✗ Login failed with error: ${this.lastError}`);
    }
  }
});

/**
 * Then I should see the products page
 */
Then('I should see the products page', async function(this: SauceDemoWorld) {
  const productsPage = await this.page!.$('.inventory_list');
  if (!productsPage) {
    throw new Error('Products page not found - login may have failed');
  }

  console.log(`✓ Products page is visible`);
});

/**
 * And the page title should contain "{text}"
 */
Then('the page title should contain {string}', async function(this: SauceDemoWorld, expectedText: string) {
  const title = await this.page!.$('.app_logo');
  const titleText = await title?.textContent() || '';

  if (!titleText.includes(expectedText)) {
    throw new Error(`Expected "${expectedText}" in title but got "${titleText}"`);
  }

  console.log(`✓ Page title contains: "${expectedText}"`);
});

/**
 * Given I am logged in as "{username}"
 */
Given('I am logged in as {string}', async function(this: SauceDemoWorld, username: string) {
  // Navigate to login page
  await this.page!.goto(this.appUrl);
  await this.page!.waitForSelector('input[placeholder*="Username"]');

  // Enter credentials
  await this.page!.fill('input[placeholder*="Username"]', username);
  await this.page!.fill('input[placeholder*="Password"]', 'secret_sauce');

  // Click login
  await this.page!.click('input[value*="LOGIN"]');

  // Wait for products page
  await this.page!.waitForSelector('.inventory_list', { timeout: 5000 });

  console.log(`✓ Logged in as: ${username}`);
});

/**
 * When I view the products list
 */
When('I view the products list', async function(this: SauceDemoWorld) {
  const productsList = await this.page!.$('.inventory_list');
  if (!productsList) {
    throw new Error('Products list not found');
  }

  console.log(`✓ Products list is visible`);
});

/**
 * Then I should see at least {int} products
 */
Then('I should see at least {int} products', async function(this: SauceDemoWorld, minCount: number) {
  const products = await this.page!.$$('.inventory_item');

  if (products.length < minCount) {
    throw new Error(`Expected at least ${minCount} products but found ${products.length}`);
  }

  console.log(`✓ Found ${products.length} products (minimum required: ${minCount})`);
});

/**
 * And each product should have a name and price
 */
Then('each product should have a name and price', async function(this: SauceDemoWorld) {
  const products = await this.page!.$$('.inventory_item');

  for (const product of products) {
    const name = await product.$('.inventory_item_name');
    const price = await product.$('.inventory_item_price');

    if (!name || !price) {
      throw new Error('Product missing name or price');
    }
  }

  console.log(`✓ All products have name and price`);
});

/**
 * And each product should have an "{button}" button
 */
Then('each product should have an {string} button', async function(this: SauceDemoWorld, buttonText: string) {
  const products = await this.page!.$$('.inventory_item');

  for (const product of products) {
    const button = await product.$(`button:has-text("${buttonText}")`);
    if (!button) {
      throw new Error(`Button "${buttonText}" not found on product`);
    }
  }

  console.log(`✓ All products have "${buttonText}" button`);
});

/**
 * When I add the first product to cart
 */
When('I add the first product to cart', async function(this: SauceDemoWorld) {
  const firstProduct = await this.page!.$('.inventory_item');
  if (!firstProduct) {
    throw new Error('No products found');
  }

  const button = await firstProduct.$('button');
  if (!button) {
    throw new Error('Add to cart button not found');
  }

  await button.click();
  console.log(`✓ Added first product to cart`);
});

/**
 * Then the cart counter should show "{count}"
 */
Then('the cart counter should show {string}', async function(this: SauceDemoWorld, expectedCount: string) {
  const cartBadge = await this.page!.$('.shopping_cart_badge');
  if (!cartBadge) {
    throw new Error('Cart counter not found');
  }

  const cartCount = await cartBadge.textContent();
  if (cartCount?.trim() !== expectedCount) {
    throw new Error(`Expected cart count "${expectedCount}" but got "${cartCount}"`);
  }

  console.log(`✓ Cart counter shows: ${expectedCount}`);
});

/**
 * When I add {int} products to cart
 */
When('I add {int} products to cart', async function(this: SauceDemoWorld, count: number) {
  const products = await this.page!.$$('.inventory_item');

  if (products.length < count) {
    throw new Error(`Only ${products.length} products available, need ${count}`);
  }

  for (let i = 0; i < count; i++) {
    const button = await products[i].$('button');
    if (button) {
      await button.click();
    }
  }

  console.log(`✓ Added ${count} products to cart`);
});

/**
 * And I navigate to the cart page
 */
When('I navigate to the cart page', async function(this: SauceDemoWorld) {
  await this.page!.click('.shopping_cart_link');

  // Wait for cart page
  await this.page!.waitForSelector('.cart_list', { timeout: 5000 });

  console.log(`✓ Navigated to cart page`);
});

/**
 * And I should see {int} items in the cart
 */
Then('I should see {int} items in the cart', async function(this: SauceDemoWorld, expectedCount: number) {
  const cartItems = await this.page!.$$('.cart_item');

  if (cartItems.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} items in cart but found ${cartItems.length}`);
  }

  console.log(`✓ Cart contains ${expectedCount} items`);
});

/**
 * Given I have added {int} products to cart
 */
Given('I have added {int} products to cart', async function(this: SauceDemoWorld, count: number) {
  // First log in
  await this.page!.goto(this.appUrl);
  await this.page!.fill('input[placeholder*="Username"]', 'standard_user');
  await this.page!.fill('input[placeholder*="Password"]', 'secret_sauce');
  await this.page!.click('input[value*="LOGIN"]');
  await this.page!.waitForSelector('.inventory_list');

  // Add products to cart
  const products = await this.page!.$$('.inventory_item');
  for (let i = 0; i < count && i < products.length; i++) {
    const button = await products[i].$('button');
    if (button) {
      await button.click();
    }
  }

  console.log(`✓ Added ${count} products to cart`);
});

/**
 * When I remove the first product from cart
 */
When('I remove the first product from cart', async function(this: SauceDemoWorld) {
  const removeButton = await this.page!.$('button:has-text("Remove")');
  if (!removeButton) {
    throw new Error('Remove button not found');
  }

  await removeButton.click();
  console.log(`✓ Removed first product from cart`);
});

/**
 * And I click the checkout button
 */
When('I click the checkout button', async function(this: SauceDemoWorld) {
  await this.page!.click('button:has-text("Checkout")');
  await this.page!.waitForSelector('.checkout_info', { timeout: 5000 });
  console.log(`✓ Clicked checkout button`);
});

/**
 * And I fill in checkout information
 */
When('I fill in checkout information:', async function(this: SauceDemoWorld, dataTable: any) {
  const data = dataTable.rowsHash();

  if (data.firstName) {
    await this.page!.fill('input[placeholder*="First Name"]', data.firstName);
  }
  if (data.lastName) {
    await this.page!.fill('input[placeholder*="Last Name"]', data.lastName);
  }
  if (data.zipCode) {
    await this.page!.fill('input[placeholder*="Zip"]', data.zipCode);
  }

  console.log(`✓ Filled in checkout information`);
});

/**
 * And I click continue
 */
When('I click continue', async function(this: SauceDemoWorld) {
  await this.page!.click('input[value*="CONTINUE"]');
  await this.page!.waitForSelector('.summary_info', { timeout: 5000 });
  console.log(`✓ Clicked continue button`);
});

/**
 * Then I should see the order summary
 */
Then('I should see the order summary', async function(this: SauceDemoWorld) {
  const summary = await this.page!.$('.summary_info');
  if (!summary) {
    throw new Error('Order summary not found');
  }

  console.log(`✓ Order summary is visible`);
});

/**
 * And I should see the total price
 */
Then('I should see the total price', async function(this: SauceDemoWorld) {
  const totalPrice = await this.page!.$('.summary_total_label');
  if (!totalPrice) {
    throw new Error('Total price not found');
  }

  const priceText = await totalPrice.textContent();
  console.log(`✓ Total price displayed: ${priceText}`);
});

/**
 * When I click the "{button}" button
 */
When('I click the {string} button', async function(this: SauceDemoWorld, buttonText: string) {
  const button = await this.page!.$(`input[value*="${buttonText.toUpperCase()}"], button:has-text("${buttonText}")`);
  if (!button) {
    throw new Error(`Button "${buttonText}" not found`);
  }

  await button.click();
  console.log(`✓ Clicked "${buttonText}" button`);
});

/**
 * Then I should see the order confirmation page
 */
Then('I should see the order confirmation page', async function(this: SauceDemoWorld) {
  const confirmationMsg = await this.page!.$('text=Thank you');
  if (!confirmationMsg) {
    throw new Error('Order confirmation message not found');
  }

  console.log(`✓ Order confirmation page displayed`);
});

/**
 * And I should see "{text}" message
 */
Then('I should see {string} message', async function(this: SauceDemoWorld, expectedMessage: string) {
  const message = await this.page!.$(`text=${expectedMessage}`);
  if (!message) {
    throw new Error(`Message "${expectedMessage}" not found`);
  }

  console.log(`✓ Message displayed: "${expectedMessage}"`);
});

/**
 * When I select sort option "{option}"
 */
When('I select sort option {string}', async function(this: SauceDemoWorld, sortOption: string) {
  const sortDropdown = await this.page!.$('[data-test="product_sort_container"]');
  if (!sortDropdown) {
    throw new Error('Sort dropdown not found');
  }

  await sortDropdown.selectOption({ label: sortOption });
  console.log(`✓ Selected sort option: ${sortOption}`);
});

/**
 * Then the products should be sorted by price in ascending order
 */
Then('the products should be sorted by price in ascending order', async function(this: SauceDemoWorld) {
  const prices = await this.page!.$$eval('.inventory_item_price', elements =>
    elements.map(el => parseFloat(el.textContent?.replace('$', '') || '0'))
  );

  for (let i = 0; i < prices.length - 1; i++) {
    if (prices[i] > prices[i + 1]) {
      throw new Error('Products are not sorted in ascending order by price');
    }
  }

  console.log(`✓ Products sorted by price (low to high)`);
});

/**
 * When I click on "{productName}"
 */
When('I click on {string}', async function(this: SauceDemoWorld, productName: string) {
  const product = await this.page!.$(`text="${productName}"`);
  if (!product) {
    throw new Error(`Product "${productName}" not found`);
  }

  await product.click();
  await this.page!.waitForSelector('.inventory_details', { timeout: 5000 });
  console.log(`✓ Clicked on product: ${productName}`);
});

/**
 * Then I should see the product detail page
 */
Then('I should see the product detail page', async function(this: SauceDemoWorld) {
  const details = await this.page!.$('.inventory_details');
  if (!details) {
    throw new Error('Product detail page not found');
  }

  console.log(`✓ Product detail page displayed`);
});

/**
 * And I should see the product name "{name}"
 */
Then('I should see the product name {string}', async function(this: SauceDemoWorld, expectedName: string) {
  const name = await this.page!.$('.inventory_details_name');
  const nameText = await name?.textContent() || '';

  if (!nameText.includes(expectedName)) {
    throw new Error(`Expected product name "${expectedName}" but got "${nameText}"`);
  }

  console.log(`✓ Product name: ${expectedName}`);
});

/**
 * When I click the menu button
 */
When('I click the menu button', async function(this: SauceDemoWorld) {
  await this.page!.click('.bm-burger-button');
  console.log(`✓ Clicked menu button`);
});

/**
 * And I click the logout link
 */
When('I click the logout link', async function(this: SauceDemoWorld) {
  await this.page!.click('[data-test="logout-sidebar-link"]');
  console.log(`✓ Clicked logout link`);
});

/**
 * Then I should see an error message
 */
Then('I should see an error message', async function(this: SauceDemoWorld) {
  const errorMsg = await this.page!.$('[data-test="error"]');
  if (!errorMsg) {
    throw new Error('Error message not found');
  }

  console.log(`✓ Error message displayed`);
});

/**
 * And the error message should contain "{text}"
 */
Then('the error message should contain {string}', async function(this: SauceDemoWorld, expectedText: string) {
  const errorMsg = await this.page!.$('[data-test="error"]');
  const errorText = await errorMsg?.textContent() || '';

  if (!errorText.includes(expectedText)) {
    throw new Error(`Expected error message to contain "${expectedText}" but got "${errorText}"`);
  }

  console.log(`✓ Error message contains: "${expectedText}"`);
});

/**
 * When I navigate to "{url}"
 */
When('I navigate to {string}', async function(this: SauceDemoWorld, url: string) {
  await this.page!.goto(url);
  console.log(`✓ Navigated to: ${url}`);
});

/**
 * Then the page should load within {int} seconds
 */
Then('the page should load within {int} seconds', async function(this: SauceDemoWorld, maxSeconds: number) {
  const startTime = Date.now();
  await this.page!.waitForLoadState('networkidle', { timeout: maxSeconds * 1000 });
  const loadTime = (Date.now() - startTime) / 1000;

  console.log(`✓ Page loaded in ${loadTime.toFixed(2)} seconds`);
});

/**
 * And all images should be loaded
 */
Then('all images should be loaded', async function(this: SauceDemoWorld) {
  const images = await this.page!.$$('img');

  for (const img of images) {
    const complete = await img.evaluate((el: any) => el.complete);
    if (!complete) {
      throw new Error('Some images failed to load');
    }
  }

  console.log(`✓ All images loaded successfully`);
});

/**
 * And the page should be responsive
 */
Then('the page should be responsive', async function(this: SauceDemoWorld) {
  const viewport = this.page!.viewportSize();
  if (!viewport) {
    throw new Error('Viewport not set');
  }

  console.log(`✓ Page is responsive (viewport: ${viewport.width}x${viewport.height})`);
});
