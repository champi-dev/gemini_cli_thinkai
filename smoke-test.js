#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function smokeTest() {
  console.log('🔥 Running ThinkAI CLI Smoke Test...\n');
  
  const testDir = path.join(__dirname, 'smoke-test-tmp');
  
  try {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
    process.chdir(testDir);
    
    // Test 1: Basic file creation
    console.log('📝 Test 1: Creating a simple server file...');
    const { stdout: out1 } = await execAsync(
      'echo "write a simple node.js hello world server" | thinkai -y'
    );
    
    const files = await fs.readdir(testDir);
    if (!files.includes('server.js')) {
      throw new Error('server.js not created!');
    }
    
    const content = await fs.readFile('server.js', 'utf-8');
    if (!content || content.length < 10) {
      throw new Error('server.js is empty or too small!');
    }
    
    console.log('✅ File created successfully with content\n');
    
    // Test 2: Golang specific test (regression)
    console.log('🐹 Test 2: Creating a Go server...');
    await fs.rm('*', { force: true }); // Clean up
    
    const { stdout: out2 } = await execAsync(
      'echo "write a golang hello world server" | thinkai -y'
    );
    
    const files2 = await fs.readdir(testDir);
    if (!files2.includes('server.go')) {
      console.error('Files created:', files2);
      throw new Error('server.go not created! Got: ' + files2.join(', '));
    }
    
    console.log('✅ Go file created successfully\n');
    
    // Test 3: Question handling
    console.log('❓ Test 3: Answering a question...');
    const { stdout: out3 } = await execAsync(
      'echo "how can I test it locally?" | thinkai -y'
    );
    
    if (out3.includes('Executing local tools')) {
      throw new Error('Question triggered tool execution!');
    }
    
    console.log('✅ Question handled without tool execution\n');
    
    // Cleanup
    process.chdir(__dirname);
    await fs.rm(testDir, { recursive: true, force: true });
    
    console.log('🎉 All smoke tests passed!\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Smoke test failed:', error.message);
    
    // Cleanup on failure
    try {
      process.chdir(__dirname);
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    
    process.exit(1);
  }
}

// Run the smoke test
smokeTest();