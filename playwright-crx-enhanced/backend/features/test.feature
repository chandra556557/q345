@bdd @e2e @saucedemo
Feature: SauceDemo E2E Testing
  As a user
  I want to test the SauceDemo application
  So that I can verify the complete user workflow

  Background:
    Given the application is loaded

  @smoke @login @positive
  Scenario: Successful login with valid credentials
    When I navigate to the login page
    And I enter username "standard_user"
    And I enter password "secret_sauce"
    And I click the login button
    Then I should see the products page
    And the page title should contain "Swag Labs"

  @smoke @products @positive
  Scenario: View products after login
    Given I am logged in as "standard_user"
    When I navigate to the products page
    Then I should see at least 6 products
    And each product should have a name and price

  @smoke @logout @positive
  Scenario: Successful logout
    Given I am logged in as "standard_user"
    When I click the menu button
    And I click logout
    Then I should be redirected to the login page
    And the username field should be empty

  @api @error @negative
  Scenario: Login fails with invalid credentials
    When I navigate to the login page
    And I enter username "invalid_user"
    And I enter password "wrong_password"
    And I click the login button
    Then I should see an error message
    And the error message should contain "do not match"

  @shopping-cart @positive
  Scenario: Add item to cart
    Given I am logged in as "standard_user"
    And I am on the products page
    When I click "Add to cart" for the first product
    Then the cart counter should show "1"
    And the button text should change to "Remove from cart"

  @checkout @positive
  Scenario: Complete checkout process
    Given I am logged in as "standard_user"
    And I have 2 items in my cart
    When I click the cart icon
    And I click "Checkout"
    And I fill in first name "John"
    And I fill in last name "Doe"
    And I fill in postal code "12345"
    And I click "Continue"
    And I click "Finish"
    Then I should see "Thank you for your order"
    And the order is complete
