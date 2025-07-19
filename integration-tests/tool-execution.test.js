import { expect } from 'chai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ThinkAI CLI Tool Execution Integration Tests', function() {
  this.timeout(30000);
  
  const testDir = path.join(__dirname, 'test-workspace');
  const cliPath = process.env.GEMINI_CLI_PATH || 'thinkai';
  
  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
    process.chdir(testDir);
  });
  
  afterEach(async () => {
    // Clean up test directory
    process.chdir(__dirname);
    await fs.rm(testDir, { recursive: true, force: true });
  });
  
  describe('File Creation', () => {
    it('should create a Node.js server file', async () => {
      const { stdout, stderr } = await execAsync(
        `echo "write a simple node.js hello world server" | ${cliPath} --non-interactive`
      );
      
      // Check file was created
      const files = await fs.readdir(testDir);
      expect(files).to.include('server.js');
      
      // Check file has content
      const content = await fs.readFile(path.join(testDir, 'server.js'), 'utf-8');
      expect(content).to.not.be.empty;
      expect(content).to.include('http');
      expect(content).to.include('Hello World');
    });
    
    it('should create a Python server file', async () => {
      const { stdout, stderr } = await execAsync(
        `echo "write a simple python server" | ${cliPath} --non-interactive`
      );
      
      const files = await fs.readdir(testDir);
      expect(files).to.include('server.py');
      
      const content = await fs.readFile(path.join(testDir, 'server.py'), 'utf-8');
      expect(content).to.not.be.empty;
    });
    
    it('should create a Go server file', async () => {
      const { stdout, stderr } = await execAsync(
        `echo "write a simple golang server" | ${cliPath} --non-interactive`
      );
      
      const files = await fs.readdir(testDir);
      expect(files).to.include('server.go');
      
      const content = await fs.readFile(path.join(testDir, 'server.go'), 'utf-8');
      expect(content).to.not.be.empty;
      expect(content).to.include('package main');
    });
  });
  
  describe('Command Execution', () => {
    it('should execute commands', async () => {
      // First create a simple script
      await fs.writeFile(path.join(testDir, 'test.js'), 'console.log("Test Output");');
      
      const { stdout, stderr } = await execAsync(
        `echo "run node test.js" | ${cliPath} --non-interactive`
      );
      
      expect(stdout).to.include('Test Output');
    });
    
    it('should handle compound actions (write and execute)', async () => {
      const { stdout, stderr } = await execAsync(
        `echo "write a simple node.js server that prints test123 and execute it" | ${cliPath} --non-interactive`
      );
      
      // Check file was created
      const files = await fs.readdir(testDir);
      expect(files).to.include('server.js');
      
      // Output should show execution happened
      expect(stdout).to.include('Executing');
    });
  });
  
  describe('Context Awareness', () => {
    it('should understand "run it" in context', async () => {
      // Create a Python file first
      await execAsync(`echo "write a python hello world script" | ${cliPath} --non-interactive`);
      
      // Then run it
      const { stdout, stderr } = await execAsync(
        `echo "run it" | ${cliPath} --non-interactive`
      );
      
      expect(stdout).to.include('python');
    });
  });
  
  describe('Question Handling', () => {
    it('should answer questions without executing tools', async () => {
      const { stdout, stderr } = await execAsync(
        `echo "how can I test it locally?" | ${cliPath} --non-interactive`
      );
      
      // Should not execute tools
      expect(stdout).to.not.include('Executing local tools');
      
      // Should provide helpful answer
      expect(stdout.toLowerCase()).to.include.oneOf(['test', 'local', 'server']);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle invalid commands gracefully', async () => {
      const { stdout, stderr } = await execAsync(
        `echo "run nonexistent-command" | ${cliPath} --non-interactive`
      );
      
      // Should complete without crashing
      expect(stdout).to.exist;
    });
    
    it('should handle malformed requests', async () => {
      const { stdout, stderr } = await execAsync(
        `echo "!!@#$%^&*()" | ${cliPath} --non-interactive`
      );
      
      // Should not crash
      expect(stdout).to.exist;
    });
  });
});