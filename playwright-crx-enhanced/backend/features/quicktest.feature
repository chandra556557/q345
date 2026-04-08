@smoke @login
Feature: SauceDemo E2E Testing
  
  Scenario: Successful login with valid credentials
    When I navigate to the login page
    And I enter username "standard_user"
    And I enter password "secret_sauce"
    And I click the login button
    Then I should see the products page
