# CSV Data-Driven Testing API Reference

## 📋 Overview

The backend now includes 4 new REST API endpoints for CSV-based data-driven testing with automatic field binding to Playwright script placeholders.

**Base URL:** `http://localhost:3001/api/testdata/csv`

**Authentication:** All endpoints require Bearer token (JWT)

**Swagger UI:** `http://localhost:3001/api-docs`

---

## 🔌 API Endpoints

### 1. Upload CSV and Bind to Script
**Endpoint:** `POST /testdata/csv/upload-and-bind`

**Purpose:** Upload a CSV file, auto-detect field bindings, optionally persist to database.

**Request:**
```http
POST /api/testdata/csv/upload-and-bind HTTP/1.1
Host: localhost:3001
Authorization: Bearer <jwt-token>
Content-Type: multipart/form-data

file: <CSV file>
scriptId: <script-uuid>
suiteName: Login Test Data (optional)
suiteId: <existing-suite-uuid> (optional)
environment: dev (optional, default: dev)
save: true (optional, default: false)
```

**Form Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | file | ✅ | CSV file (.csv) max 5MB |
| `scriptId` | string | ✅ | UUID of Playwright script with `{{placeholders}}` |
| `suiteName` | string | ❌ | Name for auto-created test suite |
| `suiteId` | string | ❌ | Existing suite ID to append data to |
| `environment` | string | ❌ | Environment name (dev/staging/prod) |
| `save` | boolean | ❌ | Persist rows to TestData table |

**Response (200 OK):**
```json
{
  "success": true,
  "csvHeaders": ["email", "password", "username"],
  "rowCount": 2,
  "fieldBindings": [
    {
      "csvHeader": "email",
      "placeholder": "email",
      "confidence": "exact"
    },
    {
      "csvHeader": "password",
      "placeholder": "password",
      "confidence": "exact"
    },
    {
      "csvHeader": "username",
      "placeholder": "username",
      "confidence": "none"
    }
  ],
  "unmappedHeaders": [],
  "unmappedPlaceholders": ["username"],
  "dataRows": [
    {
      "index": 0,
      "values": {
        "email": "alice@test.com",
        "password": "Pass@123",
        "username": "alice"
      }
    },
    {
      "index": 1,
      "values": {
        "email": "bob@test.com",
        "password": "Secure456!",
        "username": "bob"
      }
    }
  ],
  "savedSuiteId": "550e8400-e29b-41d4-a716-446655440000",
  "savedCount": 2
}
```

**Error Responses:**
- `400` — Invalid CSV, missing scriptId, or file validation failed
- `401` — Unauthorized (missing or invalid token)
- `404` — Script not found

**Example cURL:**
```bash
curl -X POST http://localhost:3001/api/testdata/csv/upload-and-bind \
  -H "Authorization: Bearer eyJhbGc..." \
  -F "file=@credentials.csv" \
  -F "scriptId=abc-123-def-456" \
  -F "save=true" \
  -F "suiteName=Login Credentials"
```

---

### 2. Parse CSV Inline (No File Upload)
**Endpoint:** `POST /testdata/csv/parse`

**Purpose:** Parse raw CSV content as text string (useful for preview/validation).

**Request:**
```json
POST /api/testdata/csv/parse HTTP/1.1
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "csvContent": "email,password,username\nalice@test.com,Pass@123,alice\nbob@test.com,Secure456!,bob",
  "delimiter": ","
}
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `csvContent` | string | ✅ | Raw CSV content (newline-separated rows) |
| `delimiter` | string | ❌ | Field delimiter (default: `,`) |

**Response (200 OK):**
```json
{
  "success": true,
  "headers": ["email", "password", "username"],
  "rows": [
    {"email": "alice@test.com", "password": "Pass@123", "username": "alice"},
    {"email": "bob@test.com", "password": "Secure456!", "username": "bob"}
  ],
  "rowCount": 2
}
```

**Example cURL:**
```bash
curl -X POST http://localhost:3001/api/testdata/csv/parse \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "csvContent": "email,password\nalice@test.com,Pass@123\nbob@test.com,Secure456!",
    "delimiter": ","
  }'
```

---

### 3. Preview CSV Binding Result
**Endpoint:** `POST /testdata/csv/preview-binding`

**Purpose:** Show how CSV row values substitute into script placeholders (dry-run).

**Request:**
```json
POST /api/testdata/csv/preview-binding HTTP/1.1
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "scriptCode": "await page.getByLabel('Email').fill('{{email}}');\nawait page.getByLabel('Password').fill('{{password}}');",
  "fieldBindings": {
    "email": "email",
    "password": "password"
  },
  "csvRow": {
    "email": "alice@test.com",
    "password": "Pass@123"
  },
  "previewRowIndex": 0
}
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scriptCode` | string | ✅ | Playwright script with `{{placeholder}}` tokens |
| `fieldBindings` | object | ✅ | Map: placeholder name → CSV column name |
| `csvRow` | object | ✅ | Single CSV row as key-value object |
| `csvContent` | string | ❌ | Raw CSV (alternative to csvRows) |
| `csvRows` | array | ❌ | Parsed CSV rows (alternative to csvContent) |
| `previewRowIndex` | integer | ❌ | Which CSV row to preview (default: 0) |

**Response (200 OK):**
```json
{
  "success": true,
  "originalCode": "await page.getByLabel('Email').fill('{{email}}');\nawait page.getByLabel('Password').fill('{{password}}');",
  "substitutedCode": "await page.getByLabel('Email').fill('alice@test.com');\nawait page.getByLabel('Password').fill('Pass@123');",
  "appliedValues": {
    "email": "alice@test.com",
    "password": "Pass@123"
  },
  "previewRowIndex": 0,
  "totalRows": 1
}
```

**Example cURL:**
```bash
curl -X POST http://localhost:3001/api/testdata/csv/preview-binding \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "scriptCode": "await page.fill(\"{{email}}\", \"{{password}}\");",
    "fieldBindings": {"email": "email", "password": "password"},
    "csvRow": {"email": "alice@test.com", "password": "Pass@123"}
  }'
```

---

### 4. Export Test Suite as CSV
**Endpoint:** `GET /testdata/csv/export/{suiteId}`

**Purpose:** Download all test data from a suite as CSV file.

**Request:**
```http
GET /api/testdata/csv/export/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Authorization: Bearer <jwt-token>
```

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `suiteId` | string | ✅ | Test suite UUID |

**Response (200 OK):**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="suite-Login-Credentials-550e8400-e29b-41d4-a716-446655440000.csv"

email,password,username
alice@test.com,Pass@123,alice
bob@test.com,Secure456!,bob
```

**Error Responses:**
- `403` — Suite not found or unauthorized

**Example cURL:**
```bash
curl -X GET http://localhost:3001/api/testdata/csv/export/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer eyJhbGc..." \
  -o exported_data.csv
```

---

## 📊 Field Binding Matching Logic

The API automatically matches CSV column headers to script `{{placeholders}}` using:

### 1. **Exact Match** (confidence: `exact`)
- Case-insensitive exact match
- Ignores underscores, hyphens, spaces
- **Example:** CSV header `email` → Script `{{email}}` ✅

### 2. **Fuzzy Match** (confidence: `fuzzy`)
- Contains-based matching
- **Example:** CSV header `usr_email` → Script `{{email}}` ✅ (contains "email")

### 3. **No Match** (confidence: `none`)
- Column exists in CSV but no matching placeholder found
- **Example:** CSV header `username` but script has no `{{username}}` placeholder
- **Action:** Column is included in response but not substituted

---

## 📝 Example Workflow

### Step 1: Create Test CSV
**File: `test_data.csv`**
```csv
email,password,role
john.doe@company.com,SecurePass123!,admin
jane.smith@company.com,AnotherPass456@,user
```

### Step 2: Create Playwright Script
**Script Code (in your Playwright CRX dashboard):**
```javascript
await page.goto('https://app.example.com/login');
await page.getByLabel('Email').fill('{{email}}');
await page.getByLabel('Password').fill('{{password}}');
await page.getByRole('button', {name: 'Login'}).click();
await page.waitForLoadState('networkidle');
```

### Step 3: Upload CSV
```bash
curl -X POST http://localhost:3001/api/testdata/csv/upload-and-bind \
  -H "Authorization: Bearer <token>" \
  -F "file=@test_data.csv" \
  -F "scriptId=<your-script-id>" \
  -F "save=true" \
  -F "suiteName=Login Credentials"
```

### Step 4: Verify Field Bindings
Response shows:
```json
{
  "fieldBindings": [
    {"csvHeader": "email", "placeholder": "email", "confidence": "exact"},
    {"csvHeader": "password", "placeholder": "password", "confidence": "exact"},
    {"csvHeader": "role", "placeholder": "role", "confidence": "none"}
  ],
  "unmappedPlaceholders": ["role"],
  "dataRows": [
    {"index": 0, "values": {"email": "john.doe@company.com", "password": "SecurePass123!"}},
    {"index": 1, "values": {"email": "jane.smith@company.com", "password": "AnotherPass456@"}}
  ]
}
```

### Step 5: Execute (Integrates with Pipeline)
The saved test data can now be used with the data-driven pipeline:
- Row 1: Script runs with john.doe@company.com + SecurePass123!
- Row 2: Script runs with jane.smith@company.com + AnotherPass456@

---

## 🔐 Security Considerations

1. **Authentication Required** — All endpoints require valid JWT token
2. **File Validation** — Only `.csv` files with `text/csv` MIME type accepted
3. **File Size Limit** — 5MB maximum upload size
4. **User Scoping** — Scripts and suites scoped to authenticated user
5. **SQL Injection** — All data persisted via parameterized queries

---

## 🧪 Testing the APIs

### Option 1: Swagger UI (Recommended)
1. Start backend: `npm run dev`
2. Open: `http://localhost:3001/api-docs`
3. Expand "CSV Data-Driven Testing" section
4. Click "Try it out" on any endpoint
5. Fill in parameters and click "Execute"

### Option 2: Postman Collection
Use the cURL examples provided above in Postman

### Option 3: Command Line
```bash
# Login first to get token
TOKEN=$(curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@test.com","password":"password"}' \
  | jq -r '.tokens.accessToken')

# Upload CSV
curl -X POST http://localhost:3001/api/testdata/csv/upload-and-bind \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test_data.csv" \
  -F "scriptId=<script-id>" \
  -F "save=true"
```

---

## 📚 Response Status Codes

| Code | Meaning | Example Scenario |
|------|---------|------------------|
| `200` | Success | CSV parsed and bound successfully |
| `201` | Created | Data persisted to database |
| `400` | Bad Request | Invalid CSV, missing parameters |
| `401` | Unauthorized | Missing or expired JWT token |
| `403` | Forbidden | User doesn't own the suite/script |
| `404` | Not Found | Script or suite doesn't exist |
| `500` | Server Error | Database or parsing error |

---

## 🔄 Integration with Data-Driven Pipeline

Once CSV data is uploaded and persisted, integrate with the pipeline service:

```typescript
// Pseudo-code example
const csvResponse = await fetch('/api/testdata/csv/upload-and-bind', {...});
const { savedSuiteId, dataRows } = csvResponse.json();

// Pass to data-driven pipeline
const pipelineResult = await fetch('/api/data-driven-pipeline/run', {
  body: JSON.stringify({
    scriptId: '<script-id>',
    strategies: ['positive'], // Use CSV data as "positive" test cases
    testDataRows: dataRows,
    save: true
  })
});
```

---

## 📖 Related Documentation

- [Playwright CRX Field Bindings](./docs/field-bindings.md)
- [Data-Driven Pipeline Guide](./docs/data-driven-pipeline.md)
- [Test Data Management](./docs/test-data.md)

---

**Last Updated:** April 2026
**API Version:** 1.1.0
