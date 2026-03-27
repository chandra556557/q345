/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from '@playwright/test';
import { allure } from 'allure-playwright';

/**
 * Allure Reporting Example Test Suite
 * 
 * This test demonstrates how to use Allure annotations with Playwright.
 * Run with: npx playwright test allure-example.spec.ts
 * Generate report: npm run allure:generate
 * View report: npm run allure:open
 */

test.describe('Allure Reporting Example @allure', () => {
  
  test.beforeEach(async ({ page }, testInfo) => {
    // Add test description and labels to Allure report
    allure.epic('Test Automation');
    allure.feature('Allure Integration');
    allure.story('Example Test Flow');
    allure.owner('Playwright Team');
    allure.severity('critical');
    allure.tag('smoke');
    allure.tag('regression');
    
    // Add link to issue tracking
    allure.issue('JIRA-123', 'https://jira.example.com/browse/JIRA-123');
    allure.link('Documentation', 'https://docs.qameta.io/allure/', 'allure');
  });

  test('should demonstrate Allure annotations @smoke', async ({ page }) => {
    // Add steps to the Allure report
    await allure.step('Navigate to TodoMVC application', async () => {
      await page.goto('https://demo.playwright.dev/todomvc');
      allure.attachment('Page URL', page.url(), 'text/plain');
    });

    await allure.step('Add a new todo item', async () => {
      const input = page.locator('input.new-todo');
      await input.fill('Learn Allure with Playwright');
      await input.press('Enter');
      
      // Add attachment with screenshot
      const screenshot = await page.screenshot();
      allure.attachment('After adding todo', screenshot, 'image/png');
    });

    await allure.step('Verify todo was added', async () => {
      const todoItem = page.locator('.todo-list li');
      await expect(todoItem).toHaveText('Learn Allure with Playwright');
      
      // Add test parameter
      allure.parameter('Todo Count', '1');
    });

    await allure.step('Mark todo as completed', async () => {
      await page.locator('.toggle').check();
      await expect(page.locator('.todo-list li')).toHaveClass(/completed/);
    });
  });

  test('should handle multiple todos @regression', async ({ page }) => {
    allure.description('This test demonstrates adding and managing multiple todo items');
    
    await allure.step('Navigate to application', async () => {
      await page.goto('https://demo.playwright.dev/todomvc');
    });

    const todos = ['Buy groceries', 'Walk the dog', 'Learn Playwright'];
    
    await allure.step(`Add ${todos.length} todo items`, async () => {
      for (const todo of todos) {
        await allure.step(`Add todo: ${todo}`, async () => {
          await page.locator('input.new-todo').fill(todo);
          await page.locator('input.new-todo').press('Enter');
        });
      }
    });

    await allure.step('Verify all todos are displayed', async () => {
      const items = page.locator('.todo-list li');
      await expect(items).toHaveCount(todos.length);
      
      // Add attachment with todo list
      allure.attachment('Todo List', todos.join('\n'), 'text/plain');
    });

    await allure.step('Complete all todos', async () => {
      await page.locator('.toggle-all').click();
      const completedCount = await page.locator('.todo-list li.completed').count();
      expect(completedCount).toBe(todos.length);
    });
  });

  test('should filter todos by status @smoke', async ({ page }) => {
    allure.descriptionHtml('<h3>Todo Filter Test</h3><p>Tests the filter functionality of the TodoMVC app</p>');
    
    await allure.step('Setup: Add active and completed todos', async () => {
      await page.goto('https://demo.playwright.dev/todomvc');
      
      // Add active todo
      await page.locator('input.new-todo').fill('Active Todo');
      await page.locator('input.new-todo').press('Enter');
      
      // Add and complete todo
      await page.locator('input.new-todo').fill('Completed Todo');
      await page.locator('input.new-todo').press('Enter');
      await page.locator('.todo-list li .toggle').last().check();
    });

    await allure.step('Filter: Show only Active', async () => {
      await page.locator('a[href="#/active"]').click();
      await expect(page.locator('.todo-list li')).toHaveCount(1);
      await expect(page.locator('.todo-list li')).toHaveText('Active Todo');
    });

    await allure.step('Filter: Show only Completed', async () => {
      await page.locator('a[href="#/completed"]').click();
      await expect(page.locator('.todo-list li')).toHaveCount(1);
      await expect(page.locator('.todo-list li')).toHaveText('Completed Todo');
    });

    await allure.step('Filter: Show All', async () => {
      await page.locator('a[href="#/all"]').click();
      await expect(page.locator('.todo-list li')).toHaveCount(2);
    });
  });

  test('should delete a todo @regression', async ({ page }) => {
    await allure.step('Add a todo to delete', async () => {
      await page.goto('https://demo.playwright.dev/todomvc');
      await page.locator('input.new-todo').fill('Todo to delete');
      await page.locator('input.new-todo').press('Enter');
      await expect(page.locator('.todo-list li')).toHaveCount(1);
    });

    await allure.step('Delete the todo', async () => {
      await page.locator('.todo-list li').hover();
      await page.locator('.destroy').click();
      await expect(page.locator('.todo-list li')).toHaveCount(0);
    });
  });
});

test.describe('Allure Parameterized Tests @allure', () => {
  const testData = [
    { name: 'Buy milk', priority: 'low' },
    { name: 'Pay bills', priority: 'high' },
    { name: 'Call mom', priority: 'medium' },
  ];

  for (const data of testData) {
    test(`should add todo: ${data.name}`, async ({ page }) => {
      allure.parameter('Todo Name', data.name);
      allure.parameter('Priority', data.priority);
      
      await allure.step('Navigate to app', async () => {
        await page.goto('https://demo.playwright.dev/todomvc');
      });

      await allure.step(`Add todo: ${data.name}`, async () => {
        await page.locator('input.new-todo').fill(data.name);
        await page.locator('input.new-todo').press('Enter');
      });

      await allure.step('Verify todo was added', async () => {
        await expect(page.locator('.todo-list li')).toHaveText(data.name);
      });
    });
  }
});
