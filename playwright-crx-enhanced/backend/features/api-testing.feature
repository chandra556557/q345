# API Testing Feature
# Tests REST API endpoints for various operations

@bdd @api @rest-api
Feature: REST API Testing
  As an API consumer
  I want to test API endpoints
  So that I can verify the API works correctly

  Background:
    Given the API is running on "http://localhost:3001"
    And I have a valid authentication token
    And the database is seeded with test data

  # ==================== GET REQUESTS ====================

  @api @get @positive @smoke
  Scenario: Get list of all users
    When I send a GET request to "/api/users"
    Then the response status should be 200
    And the response should contain a JSON array
    And the array should have at least 3 users
    And each user should have the following fields:
      | id      |
      | email   |
      | name    |
      | role    |
    And the response time should be less than 500ms

  @api @get @pagination
  Scenario: Get paginated list of users
    When I send a GET request to "/api/users?page=2&limit=10"
    Then the response status should be 200
    And the response should have pagination metadata:
      | page      |
      | limit     |
      | total     |
      | totalPages |
    And the response should contain 10 users

  @api @get @filter
  Scenario: Filter users by role
    When I send a GET request to "/api/users?role=admin"
    Then the response status should be 200
    And all returned users should have role "admin"
    And the response should include user count

  @api @get @single-resource
  Scenario: Get specific user by ID
    Given a user with ID "123" exists
    When I send a GET request to "/api/users/123"
    Then the response status should be 200
    And the response should contain user with ID "123"
    And the response should include all user details:
      | id       |
      | email    |
      | name     |
      | role     |
      | createdAt |

  @api @get @not-found
  Scenario: Get non-existent user returns 404
    When I send a GET request to "/api/users/99999"
    Then the response status should be 404
    And the response should contain an error message
    And the error should have a code "USER_NOT_FOUND"

  # ==================== POST REQUESTS ====================

  @api @post @create @positive
  Scenario: Create new user via API
    When I send a POST request to "/api/users" with body:
      | email    | newuser@example.com |
      | name     | New User            |
      | password | SecurePass123!      |
      | role     | user                |
    Then the response status should be 201
    And the response should contain the created user
    And the response should include a user ID
    And the new user should be in the database
    And the response time should be less than 1000ms

  @api @post @validation
  Scenario: Create user fails with missing required fields
    When I send a POST request to "/api/users" with body:
      | name     | Incomplete User |
    Then the response status should be 400
    And the response should contain error details
    And the error should list missing fields:
      | email    |
      | password |

  @api @post @validation
  Scenario: Create user fails with invalid email format
    When I send a POST request to "/api/users" with body:
      | email    | invalid-email |
      | name     | Test User     |
      | password | ValidPass123  |
    Then the response status should be 400
    And the response should contain error "Invalid email format"

  @api @post @bulk
  Scenario: Create multiple users in bulk
    When I send a POST request to "/api/users/bulk" with body:
      | { "email": "bulk1@example.com", "name": "Bulk User 1", "password": "Pass123" } |
      | { "email": "bulk2@example.com", "name": "Bulk User 2", "password": "Pass123" } |
      | { "email": "bulk3@example.com", "name": "Bulk User 3", "password": "Pass123" } |
    Then the response status should be 201
    And the response should contain 3 created users
    And all users should be in the database

  # ==================== PUT REQUESTS ====================

  @api @put @update @positive
  Scenario: Update user information
    Given a user with ID "123" exists
    When I send a PUT request to "/api/users/123" with body:
      | name  | Updated Name |
      | phone | 555-9876     |
    Then the response status should be 200
    And the response should contain the updated user
    And the database should reflect the changes
    And the user's last modified timestamp should be updated

  @api @put @validation
  Scenario: Update fails with invalid data
    Given a user with ID "123" exists
    When I send a PUT request to "/api/users/123" with body:
      | email | invalid-email |
    Then the response status should be 400
    And the response should contain an error message
    And the user should not be updated in the database

  @api @put @permission
  Scenario: Cannot update another user without permission
    Given I am logged in as user "user1@example.com"
    And another user with ID "999" exists
    When I send a PUT request to "/api/users/999" with body:
      | name | Unauthorized Update |
    Then the response status should be 403
    And the response should contain error "Forbidden"
    And the user should not be updated

  # ==================== DELETE REQUESTS ====================

  @api @delete @positive
  Scenario: Delete user successfully
    Given a user with ID "123" exists
    When I send a DELETE request to "/api/users/123"
    Then the response status should be 204
    And the user should be removed from the database
    And a deletion log should be created

  @api @delete @permission
  Scenario: Cannot delete another user
    Given I am logged in as user "user1@example.com"
    And another user with ID "999" exists
    When I send a DELETE request to "/api/users/999"
    Then the response status should be 403
    And the user should still exist in the database

  @api @delete @not-found
  Scenario: Delete non-existent user returns 404
    When I send a DELETE request to "/api/users/99999"
    Then the response status should be 404
    And the response should contain error "User not found"

  # ==================== ERROR HANDLING ====================

  @api @error @authentication
  Scenario: API request without authentication token
    Given I remove my authentication token
    When I send a GET request to "/api/users"
    Then the response status should be 401
    And the response should contain error "Unauthorized"
    And the response should include a message to login

  @api @error @rate-limiting
  Scenario: API rate limiting
    When I send 101 requests to "/api/users" in rapid succession
    Then the first 100 requests should succeed
    And the 101st request should return status 429
    And the response should contain error "Too Many Requests"
    And the response should include retry-after header

  @api @error @validation
  Scenario: API returns proper validation errors
    When I send a POST request to "/api/users" with invalid JSON:
      | { invalid json } |
    Then the response status should be 400
    And the response should contain error "Invalid JSON"
    And the response should suggest correct format

  # ==================== RESPONSE FORMAT TESTS ====================

  @api @response @headers
  Scenario: API returns proper response headers
    When I send a GET request to "/api/users"
    Then the response status should be 200
    And the response should have the following headers:
      | Content-Type        | application/json |
      | Cache-Control       | no-cache         |
      | X-Content-Type-Options | nosniff      |
    And the response should include CORS headers

  @api @response @json-schema
  Scenario: API response matches JSON schema
    When I send a GET request to "/api/users"
    Then the response status should be 200
    And the response should be valid JSON
    And the response should match the users schema:
      | type     | array    |
      | minItems | 0        |
      | items    | user     |

  # ==================== PERFORMANCE TESTS ====================

  @api @performance @load
  Scenario: API handles multiple concurrent requests
    When I send 50 concurrent requests to "/api/users"
    Then all responses should have status 200
    And the average response time should be less than 500ms
    And the maximum response time should be less than 1000ms
    And the success rate should be 100%

  @api @performance @large-payload
  Scenario: API handles large response payloads
    When I send a GET request to "/api/users?limit=10000"
    Then the response status should be 200
    And the response size should be reasonable
    And the response should be properly gzip-compressed
    And the response time should be less than 2 seconds
