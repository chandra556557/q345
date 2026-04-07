# Test Data Management - BDD Tests for Project-Specific Test Data
# Demonstrates how to use fixtures and seed data with project management

@bdd @test-data @fixtures @seeds
Feature: Test Data Management per Project
  As a Test Engineer
  I want to manage test data separately for each project
  So that each project has isolated and relevant test data

  @fixtures @project1
  Scenario: Load test fixture from project 1
    Given I use project "project1"
    And I should have test data for "project1"
    When I load the test fixture "testUser"
    Then the fixture should have "email" property
    And the fixture property "email" should be "testuser@project1.com"
    And the fixture property "organization" should be "project1"

  @project2
  Scenario: Load test fixture from project 2
    Given I use project "project2"
    And I should have test data for "project2"
    When I load the test fixture "testUser"
    Then the fixture should have "email" property
    And the fixture property "email" should be "testuser@project2.staging.com"
    And the fixture property "organization" should be "project2-staging"

  @project1 @fixtures
  Scenario: List available fixtures for project 1
    Given I use project "project1"
    Then the available fixtures should include "testUser"

  @project2 @fixtures
  Scenario: List available fixtures for project 2
    Given I use project "project2"
    Then the available fixtures should include "testUser"

  @project1 @seeds
  Scenario: Load seed data from project 1
    Given I use project "project1"
    And I should have test data for "project1"
    When I load seed data "users"
    Then seed data should have 3 records
    And the available seed data should include "users"

  @project2 @seeds
  Scenario: Load seed data from project 2
    Given I use project "project2"
    And I should have test data for "project2"
    When I load seed data "users"
    Then seed data should have 3 records
    And the available seed data should include "users"

  @project1 @modify
  Scenario: Modify test fixture for project 1
    Given I use project "project1"
    And the fixture "testUser" is modified with:
      | email    | modified@project1.com |
      | firstName | Modified             |
    When I use the test fixture
    Then the fixture property "email" should be "modified@project1.com"
    And the fixture property "firstName" should be "Modified"

  @project1 @inline-data
  Scenario: Create inline test data
    Given I use project "project1"
    And I have a test user with the following data:
      | email    | newuser@project1.com |
      | username | newuser_p1          |
      | role     | user                |
    When I use the test fixture
    Then the fixture property "email" should be "newuser@project1.com"
    And the fixture property "role" should be "user"

  @project1 @summary
  Scenario: View test data summary for project 1
    Given I use project "project1"
    When I use seed data "users"
    Then I can view the test data summary

  @project2 @summary
  Scenario: View test data summary for project 2
    Given I use project "project2"
    When I use seed data "users"
    Then I can view the test data summary

  @comparison
  Scenario: Compare test data between projects
    Given I use project "project1"
    And I load the test fixture "testUser"
    And I load seed data "users"
    When I use project "project2"
    And I load the test fixture "testUser"
    Then the available seed data should include "users"
    And seed data should have 3 records
