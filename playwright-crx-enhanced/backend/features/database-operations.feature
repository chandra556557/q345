# Database Operations Feature
# Tests database CRUD operations and data integrity

@bdd @database @data-operations
Feature: Database CRUD Operations
  As a developer
  I want to test database operations
  So that I can ensure data integrity and consistency

  Background:
    Given the database is connected
    And the database tables are clean
    And test data fixtures are available

  # ==================== CREATE OPERATIONS ====================

  @database @create @positive
  Scenario: Create new record in database
    When I create a user record with:
      | email    | test@example.com    |
      | name     | Test User           |
      | role     | user                |
    Then the record should be inserted successfully
    And the record should have an auto-generated ID
    And the record should have a creation timestamp
    And I should be able to retrieve the record by ID

  @database @create @validation
  Scenario: Create fails with duplicate unique constraint
    Given a user with email "duplicate@example.com" exists
    When I try to create another user with:
      | email | duplicate@example.com |
      | name  | Another User          |
    Then the creation should fail
    And the error should be "Duplicate entry"
    And the database should still have only 1 record

  @database @create @foreign-key
  Scenario: Create fails with invalid foreign key
    When I try to create a post with:
      | title  | Test Post |
      | userId | 99999     |
    Then the creation should fail
    And the error should be "Foreign key constraint violation"
    And no post should be created

  @database @create @batch
  Scenario: Batch insert multiple records
    When I insert 1000 user records in batch
    Then all 1000 records should be inserted
    And the insertion should complete in less than 5 seconds
    And the database should have 1000 new records

  # ==================== READ OPERATIONS ====================

  @database @read @positive @smoke
  Scenario: Retrieve record by primary key
    Given a user with ID "1" exists
    When I query the user by ID "1"
    Then the query should return exactly 1 record
    And the record should contain all expected fields
    And the query should execute in less than 100ms

  @database @read @filter
  Scenario: Retrieve records with filter conditions
    Given 10 users exist with role "admin"
    And 20 users exist with role "user"
    When I query users where role = "admin"
    Then the query should return exactly 10 records
    And all records should have role "admin"

  @database @read @join
  Scenario: Retrieve records with table joins
    Given users and posts exist with relationships
    When I query users with their posts using JOIN
    Then each user should have their associated posts
    And the query should return denormalized data correctly
    And the query should execute efficiently

  @database @read @aggregation
  Scenario: Aggregate query operations
    Given the following users exist:
      | User 1 | 5 posts |
      | User 2 | 8 posts |
      | User 3 | 3 posts |
    When I query the total count of posts per user
    Then the results should show:
      | User 1 | 5 |
      | User 2 | 8 |
      | User 3 | 3 |

  @database @read @pagination
  Scenario: Query with pagination
    Given 100 records exist in the database
    When I query with page=2 and limit=10
    Then the query should return records 11-20
    And the metadata should show:
      | totalRecords   | 100 |
      | currentPage    | 2   |
      | recordsPerPage | 10  |

  @database @read @sort
  Scenario: Query with sorting
    When I query users ordered by created_at DESC
    Then the first record should be the most recently created
    And the last record should be the oldest
    And all records should be in correct order

  # ==================== UPDATE OPERATIONS ====================

  @database @update @positive
  Scenario: Update single record
    Given a user with ID "1" exists with name "Old Name"
    When I update the user with:
      | name | New Name |
    Then the update should succeed
    And the database should reflect the change
    And the updated_at timestamp should be current

  @database @update @bulk
  Scenario: Update multiple records at once
    Given 50 users with status "active"
    When I update all users with status "active" to "inactive"
    Then all 50 records should be updated
    And the updated_at timestamp should be current for all

  @database @update @conditional
    Scenario: Update fails when record modified concurrently
    Given a user record with version "1"
    And another process updates the record to version "2"
    When I try to update with version "1"
    Then the update should fail
    And the error should be "Conflict - Record was modified"
    And the database should show version "2"

  @database @update @cascade
  Scenario: Update cascades to related records
    Given a user with 5 posts
    When I update the user's status to "deleted"
    Then the user should be marked as deleted
    And all 5 posts should also be marked as deleted
    And the cascade should be logged

  # ==================== DELETE OPERATIONS ====================

  @database @delete @positive
  Scenario: Delete record successfully
    Given a user with ID "1" exists
    When I delete the user
    Then the deletion should succeed
    And the user should be removed from database
    And the record count should decrease by 1

  @database @delete @soft-delete
  Scenario: Soft delete marks record as deleted
    Given a user with ID "1" exists
    When I soft delete the user
    Then the user should be marked with deleted_at timestamp
    And the user should still exist in database
    And the user should not appear in normal queries

  @database @delete @cascade
  Scenario: Delete cascades to dependent records
    Given a user with 10 posts and 50 comments
    When I delete the user
    Then the user should be deleted
    And all 10 posts should be deleted
    And all 50 comments should be deleted
    And the cascade should be logged

  @database @delete @constraint
  Scenario: Delete fails due to foreign key constraint
    Given a user with active orders
    When I try to delete the user
    Then the deletion should fail
    And the error should be "Cannot delete - foreign key constraint"
    And the user should still exist

  # ==================== DATA INTEGRITY ====================

  @database @integrity @referential
  Scenario: Maintain referential integrity
    Given a user with posts exists
    When the database checks referential integrity
    Then all foreign keys should reference existing records
    And no orphaned records should exist

  @database @integrity @constraints
  Scenario: Enforce unique constraints
    When I try to insert a record with duplicate unique field
    Then the insertion should fail
    And the error should be "Unique constraint violation"

  @database @integrity @not-null
  Scenario: Enforce NOT NULL constraints
    When I try to insert a record with NULL required field
    Then the insertion should fail
    And the error should be "Column cannot be NULL"

  @database @integrity @check-constraint
  Scenario: Enforce check constraints
    When I try to insert an age value of -5
    Then the insertion should fail
    And the error should be "Check constraint violated"
    And the record should not be created

  # ==================== TRANSACTION TESTS ====================

  @database @transaction @positive
  Scenario: Transaction commits successfully
    When I start a transaction
    And I insert 3 records
    And I commit the transaction
    Then all 3 records should be in the database
    And the transaction should be logged

  @database @transaction @rollback
  Scenario: Transaction rollback on error
    When I start a transaction
    And I insert 3 records
    And an error occurs
    And I rollback the transaction
    Then none of the 3 records should be in the database

  @database @transaction @isolation
  Scenario: Transaction isolation levels
    When I start two concurrent transactions
    And transaction 1 reads a record
    And transaction 2 modifies the same record
    And transaction 2 commits
    Then transaction 1 should see the updated value
    And the isolation level should prevent dirty reads

  # ==================== PERFORMANCE TESTS ====================

  @database @performance @index
  Scenario: Query uses database indexes efficiently
    Given 100000 records exist
    And an index on email field exists
    When I query by email
    Then the query execution plan should use the index
    And the query should execute in less than 50ms

  @database @performance @lock
  Scenario: Database handles lock timeouts gracefully
    When 100 concurrent requests try to update the same record
    Then the database should handle lock contention
    And the requests should wait or fail gracefully
    And no deadlocks should occur

  # ==================== BACKUP & RECOVERY ====================

  @database @backup @positive
  Scenario: Database backup completes successfully
    When I initiate a database backup
    Then the backup should complete successfully
    And the backup file should be created
    And all data should be backed up

  @database @recovery @restore
  Scenario: Restore database from backup
    Given a backup file exists
    When I restore the database from backup
    Then all data should be restored
    And the database should be consistent
    And no data should be lost
