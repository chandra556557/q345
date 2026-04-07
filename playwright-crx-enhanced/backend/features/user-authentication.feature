# User Authentication Feature
# Tests user login, registration, and account management

@bdd @authentication @user-management
Feature: User Authentication and Account Management
  As a user
  I want to register, login, and manage my account
  So that I can access the application securely

  Background:
    Given the application is accessible
    And the database is connected

  # ==================== REGISTRATION TESTS ====================

  @registration @positive @smoke
  Scenario: Successfully register new user with valid data
    Given I am on the registration page
    When I enter the following user details:
      | firstName | John        |
      | lastName  | Doe         |
      | email     | john@example.com |
      | password  | SecurePass123!   |
      | confirm   | SecurePass123!   |
    And I accept the terms and conditions
    And I click the register button
    Then I should see a success message "Account created successfully"
    And I should be redirected to the login page
    And the user "john@example.com" should exist in the database

  @registration @validation
  Scenario: Registration fails with invalid email format
    Given I am on the registration page
    When I enter the following user details:
      | firstName | Jane        |
      | lastName  | Smith       |
      | email     | invalid-email   |
      | password  | SecurePass123!  |
      | confirm   | SecurePass123!  |
    And I click the register button
    Then I should see an error message "Please enter a valid email address"
    And the form should highlight the email field
    And no user should be created

  @registration @validation
  Scenario: Registration fails when passwords don't match
    Given I am on the registration page
    When I enter the following user details:
      | firstName | Bob         |
      | lastName  | Johnson     |
      | email     | bob@example.com |
      | password  | SecurePass123!  |
      | confirm   | DifferentPass456! |
    And I click the register button
    Then I should see an error message "Passwords do not match"
    And the password fields should be highlighted in red

  @registration @validation
  Scenario: Registration fails when email already exists
    Given the user "existing@example.com" already exists
    And I am on the registration page
    When I enter the following user details:
      | firstName | Tom         |
      | lastName  | Brown       |
      | email     | existing@example.com |
      | password  | SecurePass123!      |
      | confirm   | SecurePass123!      |
    And I click the register button
    Then I should see an error message "Email already registered"
    And I should see a link to login page

  # ==================== LOGIN TESTS ====================

  @login @positive @smoke
  Scenario: Successfully login with valid credentials
    Given the user "user@example.com" exists with password "ValidPass123"
    And I am on the login page
    When I enter email "user@example.com"
    And I enter password "ValidPass123"
    And I click the login button
    Then I should be redirected to the dashboard
    And I should see the user greeting "Welcome, User"
    And a session cookie should be created

  @login @security
  Scenario: Login fails with incorrect password
    Given the user "secure@example.com" exists
    And I am on the login page
    When I enter email "secure@example.com"
    And I enter password "WrongPassword"
    And I click the login button
    Then I should see an error message "Invalid email or password"
    And I should remain on the login page
    And no session should be created

  @login @security
  Scenario: Login fails with non-existent email
    Given I am on the login page
    When I enter email "nonexistent@example.com"
    And I enter password "AnyPassword123"
    And I click the login button
    Then I should see an error message "Invalid email or password"
    And the login attempt should be logged

  @login @security @brute-force
  Scenario: Account locked after multiple failed login attempts
    Given the user "locked@example.com" exists
    And I am on the login page
    When I attempt login 5 times with wrong password
    Then I should see an error message "Account temporarily locked"
    And I should see a message "Try again in 15 minutes"
    And the account should be locked in the database

  @login @remember-me
  Scenario: User can check "Remember me" for persistent login
    Given the user "remember@example.com" exists
    And I am on the login page
    When I enter email "remember@example.com"
    And I enter password "ValidPass123"
    And I check the "Remember me" checkbox
    And I click the login button
    Then I should be logged in
    And a persistent session token should be created
    And the token should expire in 30 days

  # ==================== PASSWORD RESET TESTS ====================

  @password-reset @positive
  Scenario: User successfully resets forgotten password
    Given the user "reset@example.com" exists
    And I am on the login page
    When I click the "Forgot password?" link
    Then I should be on the password reset page
    When I enter email "reset@example.com"
    And I click the send reset link button
    Then I should see a message "Reset link sent to your email"
    And a password reset email should be sent
    And the email should contain a valid reset link

  @password-reset @security
  Scenario: Password reset link expires after 1 hour
    Given a password reset token was created 61 minutes ago
    And I have the expired reset link
    When I click the reset link
    Then I should see an error message "Reset link has expired"
    And I should be redirected to password reset page

  # ==================== LOGOUT TESTS ====================

  @logout @positive
  Scenario: User successfully logs out
    Given I am logged in as "user@example.com"
    And I am on the dashboard
    When I click the logout button
    Then I should be redirected to the login page
    And my session should be destroyed
    And I should not be able to access protected pages

  @logout @security
  Scenario: Logout clears all user data from client
    Given I am logged in as "secure@example.com"
    When I click the logout button
    Then the session cookie should be deleted
    And the local storage should be cleared
    And the authentication token should be removed

  # ==================== PROFILE TESTS ====================

  @profile @update
  Scenario: User can update profile information
    Given I am logged in as "user@example.com"
    And I am on the profile page
    When I update my profile with:
      | firstName | Jonathan    |
      | lastName  | Smith       |
      | phone     | 555-1234    |
      | bio       | Software Engineer |
    And I click the save button
    Then I should see a success message "Profile updated successfully"
    And my profile should be updated in the database
    And the dashboard should show the new name

  @profile @security
  Scenario: User cannot change email to one that exists
    Given I am logged in as "user1@example.com"
    And the user "user2@example.com" exists
    And I am on the profile page
    When I try to change email to "user2@example.com"
    And I click the save button
    Then I should see an error message "Email already in use"
    And my email should not be changed

  @profile @password-change
  Scenario: User can change their password
    Given I am logged in as "user@example.com"
    And I am on the security settings page
    When I enter current password "OldPassword123"
    And I enter new password "NewPassword456!"
    And I confirm new password "NewPassword456!"
    And I click the change password button
    Then I should see a success message "Password changed successfully"
    And I should be able to login with the new password
    And the old password should no longer work

  @profile @two-factor @security
  Scenario: User can enable two-factor authentication
    Given I am logged in as "user@example.com"
    And I am on the security settings page
    When I click "Enable two-factor authentication"
    Then I should see a QR code
    And I should see a backup code
    When I scan the QR code with an authenticator app
    And I enter the 6-digit code
    And I click confirm
    Then I should see "Two-factor authentication enabled"
    And two-factor should be enabled for my account
