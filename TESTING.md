# ThinkAI CLI Testing Documentation

## Overview

The ThinkAI CLI has comprehensive test coverage including unit tests, integration tests, and end-to-end tests to ensure 100% reliability.

## Test Structure

### Unit Tests
- **Location**: `packages/*/src/**/__tests__/`
- **Framework**: Vitest
- **Coverage**: Core logic, pattern matching, intent parsing

### Integration Tests
- **Location**: `integration-tests/`
- **Framework**: Mocha + Chai
- **Coverage**: Tool execution, file operations, command running

### E2E Tests
- **Location**: `integration-tests/e2e-workflows.test.js`
- **Framework**: Mocha + Chai
- **Coverage**: Complete user workflows, multi-turn conversations

## Running Tests

### All Tests (100% Success Required)
```bash
npm run test:all
```

### Individual Test Suites
```bash
# Unit tests only
npm run test:unit

# Integration tests only  
npm run test:integration

# E2E tests only
npm run test:e2e

# Golang specific regression tests
mocha integration-tests/golang-specific.test.js
```

### With Coverage
```bash
npm run test:coverage
```

## Test Cases Covered

### 1. File Creation
- ✅ Node.js servers
- ✅ Python servers
- ✅ Go servers
- ✅ Multiple language support (Ruby, Java, C++, Rust, PHP)
- ✅ Correct file extensions
- ✅ Working code generation

### 2. Command Execution
- ✅ Simple commands
- ✅ Compound actions (write and execute)
- ✅ Context-aware execution ("run it")
- ✅ Language-specific commands

### 3. Context Awareness
- ✅ Multi-turn conversations
- ✅ Reference resolution ("it", "that")
- ✅ Language detection from context
- ✅ Previous command memory

### 4. Error Handling
- ✅ Invalid commands
- ✅ Malformed input
- ✅ API failures with fallback
- ✅ Recovery from errors

### 5. AI Integration
- ✅ Dynamic content generation
- ✅ Intent parsing
- ✅ Mode selection (code vs general)
- ✅ Fallback mechanisms

## Key Test Scenarios

### Golang Regression Test
```bash
# This specific test ensures Go files are created correctly
echo "write a simple golang server for hello world and execute it" | thinkai

# Expected:
# - Creates server.go (not server.js)
# - Contains valid Go code
# - Executes with "go run server.go"
```

### Compound Action Test
```bash
echo "write a python flask server for todos and run it" | thinkai

# Expected:
# - Creates appropriate Python file
# - Includes Flask code
# - Executes with python3 command
```

### Context Test
```bash
echo "write a node.js server" | thinkai
echo "run it" | thinkai

# Expected:
# - Second command understands "it" refers to the server
# - Runs with appropriate Node.js command
```

## Success Metrics

- **Unit Test Coverage**: >80%
- **Integration Test Success**: 100%
- **E2E Test Success**: 100%
- **Overall Success Rate**: 100%

## Debugging Failed Tests

1. **Check Debug Output**
   ```bash
   npm install -g thinkai-cli@0.2.8
   # Run with debug version to see AI responses
   ```

2. **Verbose Mode**
   ```bash
   npm run test:all -- --verbose
   ```

3. **Individual Test**
   ```bash
   mocha integration-tests/golang-specific.test.js --grep "should create a Go hello world server"
   ```

## Continuous Integration

Tests are designed to run in CI environments:
- No interactive prompts required
- Isolated test directories
- Cleanup after each test
- Timeout protection
- Exit codes for CI integration

## Adding New Tests

1. **Unit Tests**: Add to `__tests__` directory
2. **Integration Tests**: Add to `integration-tests/`
3. **Update test-all.js**: Include new test suite
4. **Document**: Add test case to this file

## Test Philosophy

- **No hardcoding**: Tests verify AI-driven behavior
- **Real scenarios**: Tests mirror actual user workflows
- **100% reliability**: All tests must pass
- **Fast feedback**: Tests run quickly (<2 minutes total)
- **Isolation**: Tests don't interfere with each other