#!/usr/bin/env node

/**
 * Test CLI Integration with Think AI
 * This script tests the actual CLI with Think AI enabled
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

// Set up environment for Think AI
process.env.USE_THINKAI = 'true';
process.env.THINKAI_BASE_URL = 'https://thinkai.lat/api';

async function testCLIResponse(input, timeout = 30000) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔧 Testing CLI with input: "${input}"`);
    
    const cli = spawn('node', ['bundle/gemini.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: '/home/champi/Dev/gemini_cli_thinkai'
    });

    let output = '';
    let errorOutput = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        cli.kill();
        reject(new Error(`CLI test timed out after ${timeout}ms`));
      }
    }, timeout);

    cli.stdout.on('data', (data) => {
      output += data.toString();
    });

    cli.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    cli.on('close', (code) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ 
          output: output.trim(), 
          error: errorOutput.trim(), 
          code,
          success: code === 0 && output.length > 0
        });
      }
    });

    cli.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    // Send input
    cli.stdin.write(input + '\n');
    cli.stdin.end();
  });
}

async function checkCLIExists() {
  try {
    const stats = readFileSync('/home/champi/Dev/gemini_cli_thinkai/bundle/gemini.js');
    return true;
  } catch (error) {
    return false;
  }
}

async function buildCLI() {
  return new Promise((resolve, reject) => {
    console.log('🔨 Building CLI...');
    
    const build = spawn('npm', ['run', 'build:packages'], {
      stdio: 'inherit',
      cwd: '/home/champi/Dev/gemini_cli_thinkai'
    });

    build.on('close', (code) => {
      if (code === 0) {
        console.log('✅ CLI build successful');
        resolve();
      } else {
        reject(new Error(`Build failed with code ${code}`));
      }
    });

    build.on('error', reject);
  });
}

async function runCLITests() {
  console.log('🧪 CLI Integration Tests for Think AI\n');
  console.log('Environment:');
  console.log('  USE_THINKAI:', process.env.USE_THINKAI);
  console.log('  THINKAI_BASE_URL:', process.env.THINKAI_BASE_URL);
  console.log('================================\n');

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    tests: []
  };

  // Check if CLI exists
  const cliExists = await checkCLIExists();
  if (!cliExists) {
    console.log('❌ CLI not found, attempting to build...');
    try {
      await buildCLI();
    } catch (error) {
      console.log('❌ Build failed:', error.message);
      return false;
    }
  }

  // Test cases
  const testCases = [
    {
      name: 'Basic Greeting',
      input: 'Hello! This is a test of the Think AI integration.',
      expectContains: ['hello', 'test', 'think', 'ai'],
      timeout: 20000
    },
    {
      name: 'Code Request',
      input: 'Write a simple JavaScript function to add two numbers.',
      expectContains: ['function', 'javascript', 'add'],
      timeout: 30000
    },
    {
      name: 'General Question',
      input: 'What is the capital of France?',
      expectContains: ['paris', 'france', 'capital'],
      timeout: 15000
    },
    {
      name: 'Help Request',
      input: 'Can you help me with programming?',
      expectContains: ['help', 'programming', 'assist'],
      timeout: 20000
    }
  ];

  // Run tests
  for (const testCase of testCases) {
    results.total++;
    console.log(`\n🧪 Test: ${testCase.name}`);
    
    try {
      const result = await testCLIResponse(testCase.input, testCase.timeout);
      
      if (result.success) {
        const output = result.output.toLowerCase();
        const containsExpected = testCase.expectContains.some(expected => 
          output.includes(expected.toLowerCase())
        );
        
        if (containsExpected) {
          console.log('✅ PASSED');
          console.log(`   Output: ${result.output.substring(0, 100)}...`);
          results.passed++;
          results.tests.push({ ...testCase, status: 'PASSED', output: result.output });
        } else {
          console.log('⚠️ PARTIAL - Response received but doesn\'t contain expected content');
          console.log(`   Output: ${result.output.substring(0, 100)}...`);
          console.log(`   Expected: ${testCase.expectContains.join(', ')}`);
          results.failed++;
          results.tests.push({ ...testCase, status: 'PARTIAL', output: result.output });
        }
      } else {
        console.log('❌ FAILED - No valid response');
        console.log(`   Output: ${result.output}`);
        console.log(`   Error: ${result.error}`);
        console.log(`   Code: ${result.code}`);
        results.failed++;
        results.tests.push({ ...testCase, status: 'FAILED', output: result.output, error: result.error });
      }
    } catch (error) {
      console.log('❌ FAILED - Exception');
      console.log(`   Error: ${error.message}`);
      results.failed++;
      results.tests.push({ ...testCase, status: 'FAILED', error: error.message });
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Summary
  console.log('\n================================');
  console.log('📊 CLI Integration Test Results:');
  console.log(`  Total Tests: ${results.total}`);
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  📈 Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);

  // Detailed results
  console.log('\n📋 Detailed Results:');
  results.tests.forEach(test => {
    const status = test.status === 'PASSED' ? '✅' : 
                   test.status === 'PARTIAL' ? '⚠️' : '❌';
    console.log(`  ${status} ${test.name}: ${test.status}`);
  });

  if (results.passed === results.total) {
    console.log('\n🎉 All CLI tests passed! Think AI integration is working correctly.');
    return true;
  } else {
    console.log('\n⚠️ Some CLI tests failed. Check the output above for details.');
    return false;
  }
}

// Run the CLI tests
runCLITests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 CLI test runner failed:', error);
    process.exit(1);
  });