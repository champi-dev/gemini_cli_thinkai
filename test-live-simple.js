#!/usr/bin/env node

/**
 * Simple Live API Test for Think AI
 * Tests the actual Think AI API endpoints using direct fetch
 */

async function testHealthCheck() {
  console.log('🏥 Testing Health Check...');
  try {
    const response = await fetch('https://thinkai.lat/api/health');
    const data = await response.json();
    console.log('✅ Health Check Success:', data);
    return true;
  } catch (error) {
    console.log('❌ Health Check Failed:', error.message);
    return false;
  }
}

async function testBasicChat() {
  console.log('\n💬 Testing Basic Chat...');
  try {
    const response = await fetch('https://thinkai.lat/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Hello! This is a test message from the Gemini CLI integration.',
        session_id: 'test-session-' + Date.now(),
        mode: 'general',
        use_web_search: false,
        fact_check: false,
      }),
    });
    
    const data = await response.json();
    console.log('✅ Basic Chat Success:');
    console.log('  Response:', data.response);
    console.log('  Session ID:', data.session_id);
    console.log('  Mode:', data.mode);
    if (data.usage) {
      console.log('  Usage:', data.usage);
    }
    return true;
  } catch (error) {
    console.log('❌ Basic Chat Failed:', error.message);
    return false;
  }
}

async function testCodeMode() {
  console.log('\n🖥️ Testing Code Mode...');
  try {
    const response = await fetch('https://thinkai.lat/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Write a simple JavaScript function to calculate the factorial of a number.',
        session_id: 'test-code-' + Date.now(),
        mode: 'code',
        use_web_search: false,
        fact_check: false,
      }),
    });
    
    const data = await response.json();
    console.log('✅ Code Mode Success:');
    console.log('  Response:', data.response.substring(0, 200) + '...');
    console.log('  Session ID:', data.session_id);
    return true;
  } catch (error) {
    console.log('❌ Code Mode Failed:', error.message);
    return false;
  }
}

async function testStreaming() {
  console.log('\n🌊 Testing Streaming...');
  try {
    const response = await fetch('https://thinkai.lat/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Count from 1 to 5 slowly.',
        session_id: 'test-stream-' + Date.now(),
        mode: 'general',
        use_web_search: false,
        fact_check: false,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let chunks = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            console.log('\n✅ Streaming Success:');
            console.log('  Total chunks:', chunks.length);
            console.log('  Combined response:', chunks.join(''));
            return true;
          }
          
          try {
            const parsed = JSON.parse(data);
            chunks.push(parsed.data);
            process.stdout.write(parsed.data);
            
            if (parsed.finished) {
              console.log('\n✅ Streaming Success:');
              console.log('  Total chunks:', chunks.length);
              console.log('  Combined response:', chunks.join(''));
              return true;
            }
          } catch (parseError) {
            console.warn('Failed to parse stream data:', data);
          }
        }
      }
    }
    
    return true;
  } catch (error) {
    console.log('❌ Streaming Failed:', error.message);
    return false;
  }
}

async function testKnowledgeBase() {
  console.log('\n📚 Testing Knowledge Base...');
  try {
    // Test knowledge search
    const searchResponse = await fetch('https://thinkai.lat/api/knowledge/search?q=javascript');
    const searchData = await searchResponse.json();
    console.log('✅ Knowledge Search Success:');
    console.log('  Results:', Object.keys(searchData).length > 0 ? 'Found results' : 'No results');
    
    // Test knowledge domains
    const domainsResponse = await fetch('https://thinkai.lat/api/knowledge/domains');
    const domainsData = await domainsResponse.json();
    console.log('✅ Knowledge Domains Success:');
    console.log('  Domains:', Array.isArray(domainsData) ? domainsData.length + ' domains' : 'Non-array response');
    
    // Test knowledge stats
    const statsResponse = await fetch('https://thinkai.lat/api/knowledge/stats');
    const statsData = await statsResponse.json();
    console.log('✅ Knowledge Stats Success:');
    console.log('  Stats:', Object.keys(statsData).length > 0 ? 'Has stats' : 'No stats');
    
    return true;
  } catch (error) {
    console.log('❌ Knowledge Base Failed:', error.message);
    return false;
  }
}

async function testSessions() {
  console.log('\n🗂️ Testing Session Management...');
  try {
    // Get sessions
    const response = await fetch('https://thinkai.lat/api/chat/sessions');
    const data = await response.json();
    console.log('✅ Get Sessions Success:');
    console.log('  Sessions:', Array.isArray(data) ? data.length + ' sessions' : 'Non-array response');
    
    return true;
  } catch (error) {
    console.log('❌ Session Management Failed:', error.message);
    return false;
  }
}

async function runLiveTests() {
  console.log('🚀 Starting Live API Tests for Think AI Integration\n');
  console.log('API Endpoint: https://thinkai.lat/api');
  console.log('================================\n');
  
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
  };
  
  // Test suite
  const tests = [
    { name: 'Health Check', fn: testHealthCheck },
    { name: 'Basic Chat', fn: testBasicChat },
    { name: 'Code Mode', fn: testCodeMode },
    { name: 'Streaming', fn: testStreaming },
    { name: 'Knowledge Base', fn: testKnowledgeBase },
    { name: 'Session Management', fn: testSessions },
  ];
  
  // Run tests
  for (const test of tests) {
    results.total++;
    try {
      const success = await test.fn();
      if (success) {
        results.passed++;
      } else {
        results.failed++;
      }
    } catch (error) {
      console.log(`❌ ${test.name} threw error:`, error.message);
      results.failed++;
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log('\n================================');
  console.log('📊 Test Results Summary:');
  console.log(`  Total Tests: ${results.total}`);
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  📈 Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
  
  if (results.failed === 0) {
    console.log('\n🎉 All tests passed! Think AI API is working correctly.');
  } else {
    console.log('\n⚠️ Some tests failed. Check the output above for details.');
  }
  
  return results.failed === 0;
}

// Run the tests
runLiveTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
  });