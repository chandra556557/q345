# SauceDemo E-commerce Tests
# Real-world example using https://saucedemo.com

@bdd @saucedemo @e2e
Feature: SauceDemo E-commerce Application
  As a QA Engineer
  I want to test the Sauce Demo e-commerce website
  So that I can verify shopping functionality

  Background:
    Given the application URL is set to "https://saucedemo.com"
    And the browser is opened

  @smoke @login
  Scenario: Successful login with valid credentials
    When I navigate to the login page
    And I enter username "standard_user"
    And I enter password "secret_sauce"
    And I click the login button
    Then I should see the products page
    And the page title should contain "Swag Labs"

  @smoke @products
  Scenario: View products list
    Given I am logged in as "standard_user"
    When I view the products list
    Then I should see at least 6 products
    And each product should have a name and price
    And each product should have an "Add to cart" button

  @shopping-cart @add-to-cart
  Scenario: Add single product to cart
    Given I am logged in as "standard_user"
    When I view the products list
    And I add the first product to cart
    Then the cart counter should show "1"
    And the product should show "Remove" button instead of "Add to cart"

  @shopping-cart @multi-add
  Scenario: Add multiple products to cart
    Given I am logged in as "standard_user"
    When I view the products list
    And I add 3 products to cart
    Then the cart counter should show "3"
    And I navigate to the cart page
    And I should see 3 items in the cart

  @shopping-cart @remove
  Scenario: Remove product from cart
    Given I am logged in as "standard_user"
    And I have added 2 products to cart
    When I navigate to the cart page
    And I remove the first product from cart
    Then I should see 1 item in the cart
    And the cart counter should show "1"

  @checkout @complete-purchase
  Scenario: Complete checkout process
    Given I am logged in as "standard_user"
    And I have added products to cart:
      | Sauce Labs Backpack      |
      | Sauce Labs Bike Light    |
    When I navigate to the cart page
    And I click the checkout button
    And I fill in checkout information:
      | firstName | John        |
      | lastName  | Doe         |
      | zipCode   | 12345       |
    And I click continue
    Then I should see the order summary
    And I should see the total price

  @checkout @finalize
  Scenario: Finalize order
    Given I am logged in as "standard_user"
    And I have products in cart
    And I am on the checkout summary page
    When I click the "Finish" button
    Then I should see the order confirmation page
    And I should see "Thank you for your order" message

  @sorting @price-low-high
  Scenario: Sort products by price low to high
    Given I am logged in as "standard_user"
    When I view the products list
    And I select sort option "Price (low to high)"
    Then the products should be sorted by price in ascending order

  @sorting @price-high-low
  Scenario: Sort products by price high to low
    Given I am logged in as "standard_user"
    When I view the products list
    And I select sort option "Price (high to low)"
    Then the products should be sorted by price in descending order

  @filter @single-item
  Scenario: Filter to view single product
    Given I am logged in as "standard_user"
    When I click on "Sauce Labs Backpack"
    Then I should see the product detail page
    And I should see the product name "Sauce Labs Backpack"
    And I should see the product price
    And I should see the product description

  @logout
  Scenario: Logout from application
    Given I am logged in as "standard_user"
    When I click the menu button
    And I click the logout link
    Then I should be redirected to the login page
    And the username field should be empty

  @error-handling @invalid-login
  Scenario: Login with invalid credentials
    When I navigate to the login page
    And I enter username "invalid_user"
    And I enter password "wrong_password"
    And I click the login button
    Then I should see an error message
    And the error message should contain "Username and password do not match"

  @performance @page-load
  Scenario: Verify page load performance
    When I navigate to "https://saucedemo.com"
    Then the page should load within 5 seconds
    And all images should be loaded
    And the page should be responsive

  @accessibility
  Scenario: Verify page accessibility
    When I navigate to the login page
    Then all form inputs should have labels
    And buttons should have accessible text
    And page should have proper heading hierarchy
