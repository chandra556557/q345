const axios = require('axios');

async function testMCPAPI() {
  console.log('Testing MCP API endpoints...');
  
  try {
    // Test initialize endpoint
    console.log('\n1. Testing MCP initialize endpoint...');
    const initResponse = await axios.post('http://localhost:3001/api/mcp/initialize', {
      sessionId: 'test-session-' + Date.now(),
      headless: true
    });
    console.log('Initialize response:', initResponse.data);
    
    // Test create page endpoint
    console.log('\n2. Testing MCP create-page endpoint...');
    const pageResponse = await axios.post('http://localhost:3001/api/mcp/create-page', {
      sessionId: 'test-session-' + Date.now()
    });
    console.log('Create page response:', pageResponse.data);
    
  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
  }
}

testMCPAPI();