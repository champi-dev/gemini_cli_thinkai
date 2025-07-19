/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const bundlePath = join(rootDir, 'bundle', 'gemini.js');
const testDir = join(rootDir, 'test-integration');

describe('Agentic Think AI CLI Integration Tests', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    
    // Change to test directory for consistent testing
    process.chdir(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    
    // Change back to root directory
    process.chdir(rootDir);
  });

  function runCLI(input, timeout = 5000) {
    const result = spawnSync('node', [bundlePath], {
      input: input,
      encoding: 'utf8',
      timeout: timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: testDir,
    });

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      status: result.status,
      error: result.error,
    };
  }

  describe('File Operations', () => {
    it('should read existing files', () => {
      // Create a test file
      const testContent = 'This is a test file\nWith multiple lines\nFor testing purposes';
      const testFile = join(testDir, 'test-read.txt');
      writeFileSync(testFile, testContent);

      const result = runCLI('read file test-read.txt');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('test-read.txt');
      expect(result.stdout).toContain('This is a test file');
    });

    it('should create new files', () => {
      const result = runCLI('create a file called new-file.txt with content "Hello World"');
      
      expect(result.status).toBe(0);
      
      // Check if file was actually created
      const newFile = join(testDir, 'new-file.txt');
      if (existsSync(newFile)) {
        const content = readFileSync(newFile, 'utf8');
        expect(content).toContain('Hello World');
      }
    });

    it('should list directory contents', () => {
      // Create some test files
      writeFileSync(join(testDir, 'file1.txt'), 'content1');
      writeFileSync(join(testDir, 'file2.js'), 'console.log("test");');
      mkdirSync(join(testDir, 'subdir'));

      const result = runCLI('list files in current directory');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('file1.txt');
      expect(result.stdout).toContain('file2.js');
      expect(result.stdout).toContain('subdir');
    });

    it('should handle file read errors gracefully', () => {
      const result = runCLI('read file non-existent-file.txt');
      
      // Should not crash, should handle error gracefully
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/error|not found|failed/i);
    });
  });

  describe('Shell Command Execution', () => {
    it('should execute pwd command', () => {
      const result = runCLI('run pwd command');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(testDir);
    });

    it('should execute ls command', () => {
      // Create test files
      writeFileSync(join(testDir, 'test1.txt'), 'content');
      writeFileSync(join(testDir, 'test2.txt'), 'content');

      const result = runCLI('run ls command');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('test1.txt');
      expect(result.stdout).toContain('test2.txt');
    });

    it('should execute echo command', () => {
      const result = runCLI('run echo "Hello from CLI"');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Hello from CLI');
    });

    it('should handle command execution errors', () => {
      const result = runCLI('run invalid-command-that-does-not-exist');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/error|failed|not found/i);
    });
  });

  describe('Complex Workflows', () => {
    it('should handle multi-step file operations', () => {
      // Step 1: Create a file
      let result = runCLI('create file workflow-test.txt with content "Initial content"');
      expect(result.status).toBe(0);

      // Step 2: Read the file
      result = runCLI('read file workflow-test.txt');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Initial content');

      // Step 3: List directory to confirm file exists
      result = runCLI('list files');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('workflow-test.txt');
    });

    it('should handle mixed tool and shell operations', () => {
      // Create a file using tool
      let result = runCLI('create file script.sh with content "#!/bin/bash\\necho \\"Script executed\\""');
      expect(result.status).toBe(0);

      // Make it executable using shell
      result = runCLI('run chmod +x script.sh');
      expect(result.status).toBe(0);

      // List files to verify
      result = runCLI('list files');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('script.sh');
    });

    it('should handle directory operations', () => {
      // Create directory
      let result = runCLI('run mkdir test-subdir');
      expect(result.status).toBe(0);

      // List to verify
      result = runCLI('list files');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('test-subdir');

      // Create file in subdirectory
      result = runCLI('create file test-subdir/nested-file.txt with content "Nested content"');
      expect(result.status).toBe(0);

      // Verify with shell command
      result = runCLI('run ls -la test-subdir');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('nested-file.txt');
    });
  });

  describe('Input Parsing and Tool Detection', () => {
    it('should detect file operations with various phrasings', () => {
      const testCases = [
        'read the file package.json',
        'show me the contents of package.json',
        'what is in the file package.json',
        'display file package.json',
      ];

      testCases.forEach(input => {
        const result = runCLI(input);
        expect(result.status).toBe(0);
        // Should attempt to read package.json (even if it doesn't exist)
        expect(result.stdout).toContain('package.json');
      });
    });

    it('should detect command execution with various phrasings', () => {
      const testCases = [
        'execute pwd',
        'run the pwd command',
        'shell pwd',
        'command pwd',
      ];

      testCases.forEach(input => {
        const result = runCLI(input);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(testDir);
      });
    });

    it('should handle mixed content requests', () => {
      const result = runCLI('Please list the files in the current directory and then tell me what you think about them');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/list|directory|files/i);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty input gracefully', () => {
      const result = runCLI('');
      
      expect(result.status).toBe(0);
      // Should not crash or hang
    });

    it('should handle very long input', () => {
      const longInput = 'Please ' + 'tell me about this '.repeat(100) + 'and list files';
      const result = runCLI(longInput);
      
      expect(result.status).toBe(0);
      // Should handle gracefully without timeout
    });

    it('should handle special characters in file names', () => {
      const result = runCLI('create file "test file with spaces.txt" with content "Special file"');
      
      expect(result.status).toBe(0);
      // Should handle file names with spaces
    });

    it('should handle concurrent-like operations', () => {
      const result = runCLI('list files and also run pwd and create file concurrent-test.txt');
      
      expect(result.status).toBe(0);
      // Should handle multiple operations in one request
    });
  });

  describe('Response Quality', () => {
    it('should provide useful feedback for successful operations', () => {
      writeFileSync(join(testDir, 'feedback-test.txt'), 'Test content for feedback');
      
      const result = runCLI('read file feedback-test.txt');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Test content for feedback');
      // Should provide context or explanation, not just raw output
    });

    it('should provide helpful error messages', () => {
      const result = runCLI('read file this-file-definitely-does-not-exist.txt');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/error|not found|failed|unable/i);
      // Should explain what went wrong
    });

    it('should combine tool results with AI commentary', () => {
      writeFileSync(join(testDir, 'sample.js'), 'console.log("Hello, World!");');
      
      const result = runCLI('read file sample.js and explain what it does');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('console.log');
      // Should contain both file content and explanation
    });
  });

  describe('Tool Integration', () => {
    it('should properly integrate with read_file tool', () => {
      const testContent = 'function test() {\n  return "integration test";\n}';
      writeFileSync(join(testDir, 'integration.js'), testContent);
      
      const result = runCLI('read file integration.js');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('function test()');
      expect(result.stdout).toContain('integration test');
    });

    it('should properly integrate with list_directory tool', () => {
      writeFileSync(join(testDir, 'file-a.txt'), 'content a');
      writeFileSync(join(testDir, 'file-b.txt'), 'content b');
      mkdirSync(join(testDir, 'dir-c'));
      
      const result = runCLI('show me what files are in this directory');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('file-a.txt');
      expect(result.stdout).toContain('file-b.txt');
      expect(result.stdout).toContain('dir-c');
    });

    it('should properly integrate with run_shell_command tool', () => {
      const result = runCLI('show me the current working directory');
      
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(testDir);
    });
  });
});