#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import ora from 'ora';

const execAsync = promisify(exec);

// Test suites to run
const testSuites = [
  {
    name: 'Unit Tests - Core',
    command: 'npm test --workspace packages/core',
    critical: true
  },
  {
    name: 'Unit Tests - CLI',
    command: 'npm test --workspace packages/cli',
    critical: true
  },
  {
    name: 'Integration Tests - Tool Execution',
    command: 'mocha integration-tests/tool-execution.test.js --timeout 30000',
    critical: true
  },
  {
    name: 'E2E Tests - Workflows',
    command: 'mocha integration-tests/e2e-workflows.test.js --timeout 60000',
    critical: true
  },
  {
    name: 'Golang Specific Tests',
    command: 'mocha integration-tests/golang-specific.test.js --timeout 30000',
    critical: true
  },
  {
    name: 'Type Checking',
    command: 'npm run typecheck',
    critical: true
  },
  {
    name: 'Linting',
    command: 'npm run lint',
    critical: false
  }
];

// Test result tracking
const results = {
  passed: [],
  failed: [],
  skipped: []
};

async function runTest(suite) {
  const spinner = ora(`Running ${suite.name}...`).start();
  
  try {
    const startTime = Date.now();
    const { stdout, stderr } = await execAsync(suite.command, {
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    const duration = Date.now() - startTime;
    
    // Check for test failures in output
    const hasFailures = stdout.includes('failing') || 
                       stdout.includes('FAILED') || 
                       stdout.includes('✗') ||
                       stderr.includes('Error:');
    
    if (hasFailures && suite.critical) {
      throw new Error('Tests failed');
    }
    
    spinner.succeed(chalk.green(`✓ ${suite.name} (${duration}ms)`));
    results.passed.push(suite.name);
    
    // Show test summary if available
    const summaryMatch = stdout.match(/(\d+) passing/);
    if (summaryMatch) {
      console.log(chalk.gray(`  ${summaryMatch[0]}`));
    }
    
    return { success: true, output: stdout };
  } catch (error) {
    spinner.fail(chalk.red(`✗ ${suite.name}`));
    results.failed.push(suite.name);
    
    console.error(chalk.red(`\nError in ${suite.name}:`));
    console.error(error.message);
    if (error.stdout) {
      console.error(chalk.gray(error.stdout));
    }
    if (error.stderr) {
      console.error(chalk.red(error.stderr));
    }
    
    return { success: false, error };
  }
}

async function runAllTests() {
  console.log(chalk.bold.blue('\n🧪 ThinkAI CLI Comprehensive Test Suite\n'));
  console.log(chalk.gray('Running all unit, integration, and E2E tests...\n'));
  
  const startTime = Date.now();
  
  // Run tests sequentially to avoid conflicts
  for (const suite of testSuites) {
    const result = await runTest(suite);
    
    // Stop on critical failure
    if (!result.success && suite.critical) {
      console.log(chalk.red('\n⚠️  Critical test failed. Stopping test execution.\n'));
      break;
    }
  }
  
  const totalDuration = Date.now() - startTime;
  
  // Print summary
  console.log(chalk.bold.blue('\n📊 Test Summary\n'));
  console.log(chalk.green(`✓ Passed: ${results.passed.length}`));
  console.log(chalk.red(`✗ Failed: ${results.failed.length}`));
  console.log(chalk.gray(`⊘ Skipped: ${results.skipped.length}`));
  console.log(chalk.gray(`\nTotal duration: ${(totalDuration / 1000).toFixed(2)}s`));
  
  // Calculate success rate
  const total = results.passed.length + results.failed.length;
  const successRate = total > 0 ? (results.passed.length / total * 100).toFixed(1) : 0;
  
  console.log(chalk.bold(`\n🎯 Success Rate: ${successRate}%`));
  
  if (results.failed.length === 0) {
    console.log(chalk.bold.green('\n✅ All tests passed! 100% success rate achieved!\n'));
    process.exit(0);
  } else {
    console.log(chalk.bold.red(`\n❌ ${results.failed.length} test suite(s) failed:\n`));
    results.failed.forEach(name => {
      console.log(chalk.red(`  - ${name}`));
    });
    console.log();
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('\n💥 Unhandled error:'), error);
  process.exit(1);
});

// Run tests
runAllTests().catch(error => {
  console.error(chalk.red('\n💥 Test runner failed:'), error);
  process.exit(1);
});