#!/bin/bash

# Quick Test Script for Think AI CLI Integration

echo "🚀 Quick Test - Think AI CLI Integration"
echo "========================================"

# Set up environment
export USE_THINKAI=true
export THINKAI_BASE_URL=https://thinkai.lat/api

echo "📋 Environment Setup:"
echo "  USE_THINKAI: $USE_THINKAI"
echo "  THINKAI_BASE_URL: $THINKAI_BASE_URL"
echo ""

# Check if CLI exists
if [ ! -f "bundle/gemini.js" ]; then
    echo "❌ CLI not found. Building..."
    npm run build:packages
    if [ $? -ne 0 ]; then
        echo "❌ Build failed!"
        exit 1
    fi
    echo "✅ Build successful"
fi

echo "🧪 Testing CLI with Think AI..."
echo ""

# Test 1: Basic greeting
echo "Test 1: Basic greeting"
echo "Hello! This is a test of Think AI integration." | timeout 30s node bundle/gemini.js
echo ""

# Test 2: Code request
echo "Test 2: Code request"
echo "Write a simple function to reverse a string in JavaScript." | timeout 30s node bundle/gemini.js
echo ""

# Test 3: General question
echo "Test 3: General question"
echo "What is the capital of Japan?" | timeout 30s node bundle/gemini.js
echo ""

echo "✅ Quick test completed!"
echo "💡 For interactive testing, run: npm start"
echo "📖 For detailed testing guide, see: LOCAL_TESTING.md"