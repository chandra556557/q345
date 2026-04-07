# Project Management - BDD Tests for Dynamic Project Configuration
# This feature file demonstrates how to test multiple projects using Cucumber

@bdd @project-management @smoke @api @health
Feature: Dynamic Project Management
  As a QA Engineer
  I want to run tests against multiple projects with different configurations
  So that I can verify each project works independently

  Background:
    Given the following projects are available:
      | project1 |
      | project2 |

  @smoke @project1
  Scenario: Switch to project 1
    Given I use project "project1"
    Then I should be using project "project1"
    And the project should have database "playwright_project1"
    And the project should use port 3001

  @smoke
  Scenario: Switch to project 2
    Given I use project "project2"
    Then I should be using project "project2"
    And the project should have database "playwright_project2"
    And the project should use port 3002

  @api @health
  Scenario: Health check for project 1
    Given I use project "project1"
    When I call the health check endpoint
    Then the API should return status 200
    And the health check status should be "ok"
    And the environment should be "development"

  @api @health
  Scenario: Health check for project 2
    Given I use project "project2"
    When I call the health check endpoint
    Then the API should return status 200
    And the health check status should be "ok"
    And the environment should be "staging"

  @api @database
  Scenario: Database connection for project 1
    Given I use project "project1"
    When I call the database health check endpoint
    Then the API should return status 200
    And the health check status should be "ok"

  @api @database
  Scenario: Database connection for project 2
    Given I use project "project2"
    When I call the database health check endpoint
    Then the API should return status 200
    And the health check status should be "ok"

  @parallel @project1
  Scenario: Verify project 1 configuration
    Given I have project "project1" with database name "playwright_project1"
    When I call the health check endpoint
    Then the API should return status 200

  @parallel @project2
  Scenario: Verify project 2 configuration
    Given I have project "project2" with database name "playwright_project2"
    When I call the health check endpoint
    Then the API should return status 200

  @api @endpoints
  Scenario: Access API endpoints for project 1
    Given I use project "project1"
    When I make a request to "/api"
    Then the API should return status 200
    And the response should contain "playwright-crx-backend"

  @api @endpoints
  Scenario: Access API endpoints for project 2
    Given I use project "project2"
    When I make a request to "/api"
    Then the API should return status 200
    And the response should contain "playwright-crx-backend"
