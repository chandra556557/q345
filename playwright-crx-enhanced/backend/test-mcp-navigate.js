const axios = require('axios');

async function testMCPNavigate() {
  console.log('Testing MCP navigate functionality...');
  
  const sessionId = 'test-session-' + Date.now();
  
  try {
    // Test initialize endpoint
    console.log('\n1. Initializing session:', sessionId);
    const initResponse = await axios.post('http://localhost:3001/api/mcp/initialize', {
      sessionId: sessionId,
      headless: true
    });
    console.log('Initialize response:', initResponse.data);
    
    // Test create page endpoint
    console.log('\n2. Creating page...');
    const pageResponse = await axios.post('http://localhost:3001/api/mcp/create-page', {
      sessionId: sessionId
    });
    console.log('Create page response:', pageResponse.data);
    
    const pageId = pageResponse.data.pageInfo.id;
    console.log('Page ID created:', pageId);
    
    // Test navigate endpoint
    console.log('\n3. Testing navigate to example.com...');
    const navResponse = await axios.post('http://localhost:3001/api/mcp/navigate', {
      sessionId: sessionId,
      pageId: pageId,
      url: 'https://example.com'
    });
    console.log('Navigate response:', navResponse.data);
    
  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
  }
}

testMCPNavigate();