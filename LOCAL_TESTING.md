# 🧪 Local Testing Guide for Think AI Integration

## 🚀 Quick Setup

### 1. Build the Project
```bash
cd /home/champi/Dev/gemini_cli_thinkai
npm run build:packages
```

### 2. Configure Environment for Think AI
```bash
# Enable Think AI
export USE_THINKAI=true
export THINKAI_BASE_URL=https://thinkai.lat/api

# Or create a .env file
echo "USE_THINKAI=true" >> .env
echo "THINKAI_BASE_URL=https://thinkai.lat/api" >> .env
```

### 3. Run the CLI
```bash
# Using npm
npm start

# Or directly
node bundle/gemini.js

# Or if built
./bundle/gemini.js
```

## 🔧 Testing Methods

### Method 1: Interactive CLI Testing
```bash
# Start the CLI
npm start

# The CLI should now use Think AI instead of Gemini
# Type your messages and see Think AI responses
```

### Method 2: Non-Interactive Testing
```bash
# Single command
echo "Hello, this is a test" | npm start

# Or with the built CLI
echo "Write a JavaScript function" | ./bundle/gemini.js
```

### Method 3: Programmatic Testing
```bash
# Run our test script
node test-cli-integration.js
```

## 🎯 What to Test

### Basic Functionality
- ✅ CLI starts without errors
- ✅ Responds to simple messages
- ✅ Shows Think AI responses instead of Gemini
- ✅ Maintains conversation context

### Code Mode Testing
- ✅ Ask for code examples
- ✅ Request debugging help
- ✅ Test syntax highlighting

### Streaming Testing
- ✅ Long responses stream in real-time
- ✅ No hanging or timeout issues

## 🐛 Troubleshooting

### Common Issues

**1. CLI doesn't start**
```bash
# Check if built
ls -la bundle/
# If empty, run build
npm run build:packages
```

**2. Still using Gemini instead of Think AI**
```bash
# Check environment variables
echo $USE_THINKAI
echo $THINKAI_BASE_URL

# Make sure they're set
export USE_THINKAI=true
export THINKAI_BASE_URL=https://thinkai.lat/api
```

**3. Network/API errors**
```bash
# Test API directly
curl https://thinkai.lat/api/health

# Should return: {"service":"think-ai-full","status":"healthy","version":"1.0.0"}
```

**4. TypeScript/Build errors**
```bash
# Clean and rebuild
npm run clean
npm run build:packages
```

## 📋 Test Checklist

- [ ] CLI starts successfully
- [ ] Environment variables are set
- [ ] Health check shows Think AI connection
- [ ] Basic chat works
- [ ] Code generation works
- [ ] Streaming responses work
- [ ] Context is maintained across messages
- [ ] No errors in console

## 🎮 Sample Test Session

```bash
# Terminal 1: Start CLI
cd /home/champi/Dev/gemini_cli_thinkai
export USE_THINKAI=true
export THINKAI_BASE_URL=https://thinkai.lat/api
npm start

# In the CLI, try these commands:
> Hello! I'm testing the Think AI integration.
> Write a function to calculate fibonacci numbers.
> What programming language should I use for web development?
> Can you help me debug this JavaScript code?
```

## 🔍 Debug Mode

```bash
# Enable debug logging
export DEBUG=1
export USE_THINKAI=true
npm start

# This will show detailed logs of API calls
```

## 📊 Performance Testing

```bash
# Test response time
time echo "What is JavaScript?" | npm start

# Test streaming
echo "Write a long explanation of React" | npm start
```