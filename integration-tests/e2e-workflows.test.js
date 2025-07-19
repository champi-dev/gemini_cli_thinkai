import { expect } from 'chai';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to check if port is open
async function isPortOpen(port, host = 'localhost') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', () => {
      resolve(false);
    });
    
    socket.connect(port, host);
  });
}

// Helper to make HTTP request
async function makeHttpRequest(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

// Helper to run CLI commands interactively
function runCLI(commands, cwd) {
  return new Promise((resolve, reject) => {
    const cliPath = process.env.GEMINI_CLI_PATH || 'thinkai';
    const proc = spawn(cliPath, [], { cwd, shell: true });
    
    let output = '';
    let error = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({ output, error, code });
    });
    
    proc.on('error', reject);
    
    // Send commands with delay
    let index = 0;
    const sendNextCommand = () => {
      if (index < commands.length) {
        setTimeout(() => {
          proc.stdin.write(commands[index] + '\n');
          index++;
          sendNextCommand();
        }, 1000);
      } else {
        setTimeout(() => {
          proc.stdin.write('/quit\n');
          proc.stdin.end();
        }, 1000);
      }
    };
    
    // Start sending commands after initial prompt
    setTimeout(sendNextCommand, 2000);
  });
}

describe('ThinkAI CLI End-to-End Workflows', function() {
  this.timeout(60000);
  
  const testDir = path.join(__dirname, 'e2e-workspace');
  
  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });
  
  describe('Complete Server Creation and Testing Workflow', () => {
    it('should create and run a Node.js server successfully', async function() {
      this.timeout(30000);
      
      const { output, error, code } = await runCLI([
        'write a simple node.js hello world server on port 3456',
        'run it'
      ], testDir);
      
      expect(code).to.equal(0);
      expect(output).to.include('Created');
      expect(output).to.include('server.js');
      
      // Give server time to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if port is open (server started)
      const portOpen = await isPortOpen(3456);
      expect(portOpen).to.be.true;
      
      // Make HTTP request to verify server works
      const response = await makeHttpRequest('http://localhost:3456');
      expect(response.status).to.equal(200);
      expect(response.data).to.include('Hello');
    });
    
    it('should create and run a Python server successfully', async function() {
      this.timeout(30000);
      
      const { output, error, code } = await runCLI([
        'write a simple python http server on port 8765',
        'run it'
      ], testDir);
      
      expect(code).to.equal(0);
      expect(output).to.include('server.py');
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const portOpen = await isPortOpen(8765);
      expect(portOpen).to.be.true;
    });
  });
  
  describe('Multi-turn Conversations', () => {
    it('should maintain context across multiple commands', async () => {
      const { output, error, code } = await runCLI([
        'write a node.js file that exports a function called greet',
        'now write another file that imports and uses that function',
        'list files'
      ], testDir);
      
      expect(code).to.equal(0);
      
      // Should create multiple files
      const files = await fs.readdir(testDir);
      expect(files.length).to.be.at.least(2);
    });
    
    it('should answer questions about created code', async () => {
      const { output, error, code } = await runCLI([
        'write a python function to calculate fibonacci',
        'how does this function work?',
        'what is its time complexity?'
      ], testDir);
      
      expect(code).to.equal(0);
      expect(output).to.include('fibonacci');
      expect(output.toLowerCase()).to.include.oneOf(['recursion', 'iteration', 'complexity']);
    });
  });
  
  describe('Error Recovery', () => {
    it('should handle and recover from errors', async () => {
      const { output, error, code } = await runCLI([
        'run nonexistent.js',
        'write a simple test.js file',
        'run test.js'
      ], testDir);
      
      expect(code).to.equal(0);
      
      // Should show error for first command
      expect(output).to.include('Error');
      
      // But should successfully create and run the second file
      expect(output).to.include('test.js');
    });
  });
  
  describe('Complex Workflows', () => {
    it('should handle a complete development workflow', async () => {
      const { output, error, code } = await runCLI([
        'create a simple express.js server',
        'add a route for /api/users',
        'add error handling middleware',
        'list files'
      ], testDir);
      
      expect(code).to.equal(0);
      
      // Should create server file
      const files = await fs.readdir(testDir);
      expect(files.length).to.be.at.least(1);
      
      // Check content includes expected elements
      const serverFile = files.find(f => f.includes('server') || f.includes('app'));
      if (serverFile) {
        const content = await fs.readFile(path.join(testDir, serverFile), 'utf-8');
        expect(content).to.include('express');
        expect(content).to.include('/api/users');
      }
    });
  });
});

describe('ThinkAI CLI Language Support Tests', function() {
  this.timeout(30000);
  
  const testDir = path.join(__dirname, 'lang-test-workspace');
  const cliPath = process.env.GEMINI_CLI_PATH || 'thinkai';
  
  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });
  
  const languages = [
    { name: 'JavaScript', ext: '.js', request: 'javascript hello world', expectedContent: 'console.log' },
    { name: 'Python', ext: '.py', request: 'python hello world', expectedContent: 'print' },
    { name: 'Go', ext: '.go', request: 'golang hello world', expectedContent: 'package main' },
    { name: 'Ruby', ext: '.rb', request: 'ruby hello world', expectedContent: 'puts' },
    { name: 'Java', ext: '.java', request: 'java hello world class', expectedContent: 'public class' },
    { name: 'C++', ext: '.cpp', request: 'c++ hello world', expectedContent: '#include' },
    { name: 'Rust', ext: '.rs', request: 'rust hello world', expectedContent: 'fn main' },
    { name: 'PHP', ext: '.php', request: 'php hello world', expectedContent: '<?php' }
  ];
  
  languages.forEach(({ name, ext, request, expectedContent }) => {
    it(`should create ${name} files correctly`, async () => {
      const { output } = await runCLI([
        `write a ${request} program`
      ], testDir);
      
      const files = await fs.readdir(testDir);
      const file = files.find(f => f.endsWith(ext));
      
      expect(file).to.exist;
      
      if (file) {
        const content = await fs.readFile(path.join(testDir, file), 'utf-8');
        expect(content).to.include(expectedContent);
      }
    });
  });
});