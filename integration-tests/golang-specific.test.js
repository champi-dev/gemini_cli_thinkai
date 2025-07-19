import { expect } from 'chai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Golang Specific Tests - Regression Suite', function() {
  this.timeout(30000);
  
  const testDir = path.join(__dirname, 'golang-test-workspace');
  const cliPath = process.env.GEMINI_CLI_PATH || 'thinkai';
  
  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    process.chdir(testDir);
  });
  
  afterEach(async () => {
    process.chdir(__dirname);
    await fs.rm(testDir, { recursive: true, force: true });
  });
  
  it('should create a Go hello world server', async () => {
    const { stdout, stderr } = await execAsync(
      `echo "write a simple golang server for hello world" | ${cliPath} --non-interactive`
    );
    
    // Debug output
    console.log('STDOUT:', stdout);
    console.log('STDERR:', stderr);
    
    // Check that a Go file was created
    const files = await fs.readdir(testDir);
    console.log('Files created:', files);
    
    const goFile = files.find(f => f.endsWith('.go'));
    expect(goFile).to.exist;
    expect(goFile).to.equal('server.go');
    
    // Check file content
    const content = await fs.readFile(path.join(testDir, 'server.go'), 'utf-8');
    expect(content).to.not.be.empty;
    expect(content).to.include('package main');
    expect(content).to.include('func main');
    expect(content).to.include('http');
    expect(content).to.include('Hello World');
  });
  
  it('should create and execute a Go server', async () => {
    const { stdout, stderr } = await execAsync(
      `echo "write a simple golang server for hello world and execute it" | ${cliPath} --non-interactive`
    );
    
    // Should create server.go
    const files = await fs.readdir(testDir);
    expect(files).to.include('server.go');
    
    // Should attempt to run with go command
    expect(stdout).to.include('go run');
    expect(stdout).to.not.include('node server.js');
  });
  
  it('should run Go file when "run it" is used after Go file creation', async () => {
    // First create a Go file
    await execAsync(
      `echo "write a golang hello world program" | ${cliPath} --non-interactive`
    );
    
    // Then run it
    const { stdout, stderr } = await execAsync(
      `echo "run it" | ${cliPath} --non-interactive`
    );
    
    // Should use go run, not node
    expect(stdout).to.include('go run');
    expect(stdout).to.not.include('node');
  });
  
  it('should handle different Go file types correctly', async () => {
    const testCases = [
      { input: 'write a golang web server', expectedContent: 'http.ListenAndServe' },
      { input: 'write a go REST API server', expectedContent: 'http.HandleFunc' },
      { input: 'create a simple go http server', expectedContent: 'http.Server' }
    ];
    
    for (const testCase of testCases) {
      // Clean directory
      const files = await fs.readdir(testDir);
      for (const file of files) {
        await fs.unlink(path.join(testDir, file));
      }
      
      const { stdout } = await execAsync(
        `echo "${testCase.input}" | ${cliPath} --non-interactive`
      );
      
      const createdFiles = await fs.readdir(testDir);
      const goFile = createdFiles.find(f => f.endsWith('.go'));
      
      expect(goFile).to.exist;
      
      const content = await fs.readFile(path.join(testDir, goFile), 'utf-8');
      expect(content).to.include('package main');
    }
  });
  
  it('should not create Node.js files for Go requests', async () => {
    const { stdout } = await execAsync(
      `echo "write a golang server" | ${cliPath} --non-interactive`
    );
    
    const files = await fs.readdir(testDir);
    
    // Should NOT create any .js files
    const jsFiles = files.filter(f => f.endsWith('.js'));
    expect(jsFiles).to.be.empty;
    
    // Should create .go file
    const goFiles = files.filter(f => f.endsWith('.go'));
    expect(goFiles).to.have.lengthOf(1);
  });
});