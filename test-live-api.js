#!/usr/bin/env node

/**
 * Live API Test Script for Think AI Integration
 * Tests the actual Think AI API endpoints
 */

import { ThinkAIClient } from './packages/core/src/core/thinkAIClient.js';
import { ThinkAIChat } from './packages/core/src/core/thinkAIChat.js';
import { createAutoDetectedClient, configureThinkAI } from './packages/core/src/core/clientFactory.js';

// Mock minimal config for testing
const mockConfig = {
  getWorkingDir: () => process.cwd(),
  getFileService: () => ({}),
  getToolRegistry: () => ({
    getTool: () => null,
    getFunctionDeclarations: () => [],
  }),
  getFullContext: () => false,
  getUserMemory: () => 'Live test user preferences',
  getUsageStatisticsEnabled: () => false,
  getModel: () => 'thinkai-model',
  getEmbeddingModel: () => 'thinkai-embedding',
  getContentGeneratorConfig: () => ({
    authType: 'none',
  }),
  setModel: () => {},
  flashFallbackHandler: () => {},
};

async function testHealthCheck(client) {
  console.log('🏥 Testing Health Check...');
  try {
    const health = await client.healthCheck();
    console.log('✅ Health Check Success:', health);
    return true;
  } catch (error) {
    console.log('❌ Health Check Failed:', error.message);
    return false;
  }
}

async function testBasicMessage(client) {
  console.log('\n💬 Testing Basic Message...');
  try {
    const response = await client.sendMessageToThinkAI('Hello! This is a test message from the Gemini CLI integration.');
    console.log('✅ Basic Message Success:');
    console.log('  Response:', response.response);
    console.log('  Session ID:', response.session_id);
    console.log('  Mode:', response.mode);
    if (response.usage) {
      console.log('  Usage:', response.usage);
    }
    return true;
  } catch (error) {
    console.log('❌ Basic Message Failed:', error.message);
    return false;
  }
}

async function testCodeMode(client) {
  console.log('\n🖥️ Testing Code Mode...');
  try {
    const response = await client.sendMessageToThinkAI(
      'Write a simple JavaScript function to calculate the factorial of a number.',
      'code'
    );
    console.log('✅ Code Mode Success:');
    console.log('  Response:', response.response.substring(0, 200) + '...');
    console.log('  Session ID:', response.session_id);
    return true;
  } catch (error) {
    console.log('❌ Code Mode Failed:', error.message);
    return false;
  }
}

async function testGeneralMode(client) {
  console.log('\n🌐 Testing General Mode...');
  try {
    const response = await client.sendMessageToThinkAI(
      'What is the capital of France?',
      'general'
    );
    console.log('✅ General Mode Success:');
    console.log('  Response:', response.response);
    console.log('  Session ID:', response.session_id);
    return true;
  } catch (error) {
    console.log('❌ General Mode Failed:', error.message);
    return false;
  }
}

async function testStreaming(client) {
  console.log('\n🌊 Testing Streaming...');
  try {
    const chunks = [];
    const generator = client.sendMessageStreamToThinkAI(
      'Count from 1 to 5 slowly.',
      'general'
    );
    
    for await (const chunk of generator) {
      chunks.push(chunk);
      process.stdout.write(chunk);
    }
    
    console.log('\n✅ Streaming Success:');
    console.log('  Total chunks:', chunks.length);
    console.log('  Combined response:', chunks.join(''));
    return true;
  } catch (error) {
    console.log('❌ Streaming Failed:', error.message);
    return false;
  }
}

async function testChatConversation(client) {
  console.log('\n💭 Testing Chat Conversation...');
  try {
    const chat = client.getChat();
    
    // First message
    const response1 = await chat.sendMessage({ 
      message: 'Hello, I am testing the chat functionality.' 
    });
    console.log('✅ First message success:', response1.candidates?.[0]?.content?.parts?.[0]?.text?.substring(0, 100) + '...');
    
    // Second message (should maintain context)
    const response2 = await chat.sendMessage({ 
      message: 'What did I just say in my previous message?' 
    });
    console.log('✅ Second message success:', response2.candidates?.[0]?.content?.parts?.[0]?.text?.substring(0, 100) + '...');
    
    // Check history
    const history = chat.getHistory();
    console.log('✅ Conversation history length:', history.length);
    
    return true;
  } catch (error) {
    console.log('❌ Chat Conversation Failed:', error.message);
    return false;
  }
}

async function testKnowledgeBase(client) {
  console.log('\n📚 Testing Knowledge Base...');
  try {
    // Test knowledge search
    const searchResults = await client.searchKnowledge('javascript');
    console.log('✅ Knowledge Search Success:');
    console.log('  Results:', Object.keys(searchResults).length > 0 ? 'Found results' : 'No results');
    
    // Test knowledge domains
    const domains = await client.getKnowledgeDomains();
    console.log('✅ Knowledge Domains Success:');
    console.log('  Domains:', Array.isArray(domains) ? domains.length + ' domains' : 'Non-array response');
    
    // Test knowledge stats
    const stats = await client.getKnowledgeStats();
    console.log('✅ Knowledge Stats Success:');
    console.log('  Stats:', Object.keys(stats).length > 0 ? 'Has stats' : 'No stats');
    
    return true;
  } catch (error) {
    console.log('❌ Knowledge Base Failed:', error.message);
    return false;
  }
}

async function testSessionManagement(client) {
  console.log('\n🗂️ Testing Session Management...');
  try {
    // Get sessions
    const sessions = await client.getSessions();
    console.log('✅ Get Sessions Success:');
    console.log('  Sessions:', Array.isArray(sessions) ? sessions.length + ' sessions' : 'Non-array response');
    
    // Get current session details
    const sessionId = client.getChat().getSessionId();
    try {
      const sessionDetails = await client.getSession(sessionId);
      console.log('✅ Get Session Details Success:');
      console.log('  Session ID:', sessionDetails.id || 'No ID');
    } catch (sessionError) {
      console.log('⚠️ Get Session Details:', sessionError.message);
    }
    
    return true;
  } catch (error) {
    console.log('❌ Session Management Failed:', error.message);
    return false;
  }
}

async function testFactoryPattern() {
  console.log('\n🏭 Testing Factory Pattern...');
  try {
    // Configure Think AI
    configureThinkAI('https://thinkai.lat/api');
    
    // Create auto-detected client
    const autoClient = await createAutoDetectedClient(mockConfig);
    console.log('✅ Auto-detected client created:', autoClient.constructor.name);
    
    // Test basic functionality
    const health = await autoClient.healthCheck();
    console.log('✅ Factory client health check:', health ? 'Healthy' : 'Unhealthy');
    
    return true;
  } catch (error) {
    console.log('❌ Factory Pattern Failed:', error.message);
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
  
  // Create client
  const client = new ThinkAIClient(mockConfig, 'https://thinkai.lat/api');
  await client.initialize();
  
  // Test suite
  const tests = [
    { name: 'Health Check', fn: () => testHealthCheck(client) },
    { name: 'Basic Message', fn: () => testBasicMessage(client) },
    { name: 'Code Mode', fn: () => testCodeMode(client) },
    { name: 'General Mode', fn: () => testGeneralMode(client) },
    { name: 'Streaming', fn: () => testStreaming(client) },
    { name: 'Chat Conversation', fn: () => testChatConversation(client) },
    { name: 'Knowledge Base', fn: () => testKnowledgeBase(client) },
    { name: 'Session Management', fn: () => testSessionManagement(client) },
    { name: 'Factory Pattern', fn: () => testFactoryPattern() },
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
    console.log('\n🎉 All tests passed! Think AI integration is working correctly.');
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