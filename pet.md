Feature: JPetStore Account and Shopping

  @smoke @login @positive
  Scenario: Successful login with valid credentials
    Given I navigate to "/"
    And I click "Sign In"
    When I fill "Username" with "chandrap212"
    And I fill "Password" with "admin123"
    And I click "Login"
    Then I should see "Welcome"

  @smoke @login @negative
  Scenario: Failed login with invalid password
    Given I navigate to "/"
    And I click "Sign In"
    When I fill "Username" with "chandrap212"
    And I fill "Password" with "wrongpassword"
    And I click "Login"
    Then I should see "Invalid username or password"

  @login @negative @validation
  Scenario: Failed login with empty credentials
    Given I navigate to "/"
    And I click "Sign In"
    And I click "Login"
    Then I should see "Invalid username or password"

  @catalog @navigation
  Scenario: Navigate to catalog after login
    Given I navigate to "/"
    And I click "Sign In"
    When I fill "Username" with "chandrap212"
    And I fill "Password" with "admin123"
    And I click "Login"
    And I click "Fish"
    Then I should see "Angelfish"
