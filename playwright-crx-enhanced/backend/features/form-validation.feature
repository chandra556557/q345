# Form Validation Feature
# Tests form inputs, validation rules, and user feedback

@bdd @forms @validation @ui
Feature: Form Input Validation and User Feedback
  As a user
  I want forms to validate my input properly
  So that I can quickly identify and fix mistakes

  Background:
    Given the application is loaded
    And the form page is visible
    And JavaScript validation is enabled

  # ==================== TEXT INPUT VALIDATION ====================

  @form @validation @text @positive
  Scenario: Valid text input is accepted
    Given I am on the contact form
    When I enter "John Doe" in the name field
    And I enter "john@example.com" in the email field
    And I enter "This is a test message" in the message field
    And I submit the form
    Then the form should be submitted successfully
    And I should see confirmation "Message sent successfully"

  @form @validation @text @required
  Scenario: Required text field shows error when empty
    Given I am on the contact form
    When I leave the name field empty
    And I click the submit button
    Then the name field should show error "Name is required"
    And the field should be highlighted in red
    And the form should not be submitted

  @form @validation @email @format
  Scenario: Email field validates format
    Given I am on the contact form
    When I enter "invalid-email" in the email field
    And I click the submit button
    Then the email field should show error "Please enter a valid email"
    And the field should be highlighted
    And the form should not be submitted

  @form @validation @email @positive
  Scenario: Valid email formats are accepted
    Given I am on the contact form
    When I enter "user@example.com" in the email field
    Then the email field should show no error
    And the field should have a checkmark
    And the validation message should be cleared

  @form @validation @text @length
  Scenario: Text field validates minimum length
    Given I am on the registration form
    When I enter "ab" in the password field (minimum 8 characters required)
    And I click outside the field
    Then the password field should show error "Minimum 8 characters required"
    And the submit button should be disabled

  @form @validation @text @length-max
  Scenario: Text field validates maximum length
    Given I am on the bio form
    When I enter a string longer than 500 characters
    Then the field should show error "Maximum 500 characters allowed"
    And excess text should not be accepted

  # ==================== DROPDOWN/SELECT VALIDATION ====================

  @form @validation @dropdown @required
  Scenario: Required dropdown shows error when not selected
    Given I am on the country selection form
    When I click the submit button without selecting a country
    Then the dropdown should show error "Please select an option"
    And the form should not be submitted

  @form @validation @dropdown @positive
  Scenario: Selecting dropdown value hides error
    Given I am on the country selection form with error shown
    When I click the dropdown
    And I select "United States"
    Then the error should disappear
    And the dropdown should show "United States" as selected
    And the submit button should be enabled

  @form @validation @dropdown @search
  Scenario: Searchable dropdown filters options
    Given I am on the dropdown with search
    When I type "United" in the search
    Then only matching options should be shown:
      | United States |
      | United Kingdom |
    And typing further should filter results

  # ==================== CHECKBOX VALIDATION ====================

  @form @validation @checkbox @required
  Scenario: Required checkbox must be checked
    Given I am on the terms form
    When I click submit without checking the terms checkbox
    Then I should see error "You must accept the terms"
    And the checkbox should be highlighted
    And the form should not be submitted

  @form @validation @checkbox @multiple
  Scenario: Multiple checkboxes with minimum selection
    Given I am on the preferences form (select at least 2)
    When I check only 1 checkbox
    And I click submit
    Then I should see error "Select at least 2 options"
    And the form should not be submitted

  # ==================== RADIO BUTTON VALIDATION ====================

  @form @validation @radio @required
  Scenario: Required radio button group must have selection
    Given I am on the gender selection form
    When I click submit without selecting gender
    Then I should see error "Please select an option"
    And the radio group should be highlighted
    And the form should not be submitted

  @form @validation @radio @dependent
  Scenario: Radio button reveals dependent fields
    Given I am on the survey form
    When I select "Yes" on a radio button
    Then dependent fields should appear below
    And the fields should be editable

  # ==================== FILE UPLOAD VALIDATION ====================

  @form @validation @file @type
  Scenario: File upload validates file type
    Given I am on the document upload form (accepts PDF only)
    When I try to upload an image.jpg file
    Then I should see error "Only PDF files are allowed"
    And the file should not be uploaded

  @form @validation @file @size
  Scenario: File upload validates file size
    Given I am on the file upload form (max 5MB)
    When I try to upload a 10MB file
    Then I should see error "File size must not exceed 5MB"
    And the file should not be uploaded

  @form @validation @file @positive
  Scenario: Valid file upload succeeds
    Given I am on the document upload form
    When I upload a valid document.pdf file
    Then the file should be uploaded successfully
    And I should see the filename displayed
    And the upload progress bar should complete

  # ==================== DATE/TIME VALIDATION ====================

  @form @validation @date @format
  Scenario: Date field validates format
    Given I am on the event registration form
    When I enter "13/32/2024" in the date field
    Then I should see error "Invalid date format"
    And the field should be highlighted

  @form @validation @date @range
  Scenario: Date field validates date range
    Given I am on the booking form with minimum date = today
    When I select a date from 5 days ago
    Then I should see error "Date cannot be in the past"
    And the date should not be selectable

  @form @validation @date @picker
  Scenario: Date picker calendar interface works
    Given I am on the date field
    When I click the date picker button
    Then a calendar should appear
    And I should be able to navigate months
    And clicking a date should populate the field

  # ==================== NUMBER FIELD VALIDATION ====================

  @form @validation @number @integer
  Scenario: Number field accepts only numbers
    Given I am on the quantity form
    When I try to enter "abc" in the number field
    Then the field should not accept the input
    And no value should be shown in the field

  @form @validation @number @range
  Scenario: Number field validates range
    Given I am on the age form (must be 18-65)
    When I enter "15" in the age field
    Then I should see error "Age must be between 18 and 65"

  @form @validation @number @decimal
  Scenario: Number field accepts decimal values
    Given I am on the price form
    When I enter "19.99" in the price field
    Then the value should be accepted
    And no error should be shown

  # ==================== FORM SUBMISSION ====================

  @form @submission @positive
  Scenario: Valid form submits successfully
    Given I am on the contact form with all required fields filled
    When I click the submit button
    Then the form should be submitted
    And I should see success message "Form submitted successfully"
    And the form fields should be cleared

  @form @submission @loading
  Scenario: Submit button shows loading state
    Given I am on the registration form with all valid data
    When I click the submit button
    Then the button should show loading spinner
    And the button text should change to "Submitting..."
    And the button should be disabled during submission

  @form @submission @error
  Scenario: Form submission displays server error
    Given I am on the contact form with valid data
    And the server is returning an error
    When I click the submit button
    Then the form should remain on the page
    And I should see error message from server
    And the submitted data should be preserved in the form

  # ==================== FORM RESET ====================

  @form @reset @positive
  Scenario: Reset button clears form fields
    Given I have filled the contact form with data
    When I click the reset button
    Then all fields should be cleared
    And any validation errors should disappear
    And the form should return to initial state

  # ==================== ACCESSIBILITY ====================

  @form @accessibility @labels
  Scenario: All form fields have associated labels
    When I inspect the form
    Then every input field should have a label
    And clicking a label should focus the associated field
    And labels should be meaningful and descriptive

  @form @accessibility @keyboard
  Scenario: Form is fully keyboard navigable
    Given I am on the form
    When I use Tab key to navigate fields
    Then all fields should be reachable
    And the focus indicator should be visible
    And I should be able to submit with Enter key

  @form @accessibility @error-messages
  Scenario: Error messages are announced to screen readers
    Given I am on the form
    When I trigger a validation error
    Then the error should have aria-live="polite"
    And screen readers should announce the error
    And the error should be associated with the field using aria-describedby
