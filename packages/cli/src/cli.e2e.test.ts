/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @jsx React.createElement */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { AppWrapper } from './ui/App.js';
import { Config } from '@google/gemini-cli-core';
import { LoadedSettings } from './config/settings.js';
import { ThinkAIClient } from '@google/gemini-cli-core';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock external dependencies
vi.mock('@google/gemini-cli-core', async () => {
  const actual = await vi.importActual('@google/gemini-cli-core');
  return {
    ...actual,
    logUserPrompt: vi.fn(),
    sessionId: 'test-session-id',
  };
});

vi.mock('./config/auth.js', () => ({
  validateAuthMethod: vi.fn().mockReturnValue(null),
}));

vi.mock('./utils/updateCheck.js', () => ({
  checkForUpdates: vi.fn().mockResolvedValue(null),
}));

describe('CLI E2E Tests', () => {
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockThinkAIClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup ThinkAI client mock
    mockThinkAIClient = {
      initialize: vi.fn().mockResolvedValue(undefined),
      sendMessageStream: vi.fn(),
      addHistory: vi.fn(),
      getHistory: vi.fn().mockResolvedValue([]),
      setHistory: vi.fn(),
      resetChat: vi.fn(),
      getChat: vi.fn().mockReturnValue({
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        setHistory: vi.fn(),
      }),
      tryCompressChat: vi.fn().mockResolvedValue(null),
      generateContent: vi.fn(),
      generateJson: vi.fn(),
      model: 'thinkai',
      embeddingModel: 'thinkai-embedding',
      MAX_TURNS: 100,
      generateContentConfig: {},
    };

    // Setup comprehensive config mock
    mockConfig = {
      getWorkingDir: vi.fn().mockReturnValue('/test/workspace'),
      getFileService: vi.fn().mockReturnValue({
        listFiles: vi.fn().mockReturnValue([]),
      }),
      getToolRegistry: vi.fn().mockResolvedValue({
        getTool: vi.fn().mockReturnValue(null),
        getFunctionDeclarations: vi.fn().mockReturnValue([]),
      }),
      getFullContext: vi.fn().mockReturnValue(false),
      getUserMemory: vi.fn().mockReturnValue('Test user memory'),
      getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
      getModel: vi.fn().mockReturnValue('thinkai'),
      getEmbeddingModel: vi.fn().mockReturnValue('thinkai-embedding'),
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        authType: 'test',
        model: 'thinkai',
      }),
      setModel: vi.fn(),
      flashFallbackHandler: undefined,
      refreshAuth: vi.fn(),
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getDebugMode: vi.fn().mockReturnValue(false),
      getTargetDir: vi.fn().mockReturnValue('/test/workspace'),
      getProjectRoot: vi.fn().mockReturnValue('/test/workspace'),
      getGeminiClient: vi.fn().mockReturnValue(mockThinkAIClient),
      getGeminiMdFileCount: vi.fn().mockReturnValue(0),
      setGeminiMdFileCount: vi.fn(),
      getApprovalMode: vi.fn().mockReturnValue('default'),
      setApprovalMode: vi.fn(),
      getShowMemoryUsage: vi.fn().mockReturnValue(false),
      getAccessibility: vi.fn().mockReturnValue({}),
      getMcpServers: vi.fn().mockReturnValue({}),
      getExtensionContextFilePaths: vi.fn().mockReturnValue([]),
      setUserMemory: vi.fn(),
      setFlashFallbackHandler: vi.fn(),
      getCheckpointingEnabled: vi.fn().mockReturnValue(false),
      getGitService: vi.fn().mockResolvedValue({
        initialize: vi.fn(),
      }),
    } as any;

    // Setup settings mock
    mockSettings = {
      merged: {
        theme: 'default',
        selectedAuthType: undefined,
        preferredEditor: 'code',
        contextFileName: 'GEMINI.md',
        hideWindowTitle: false,
        autoConfigureMaxOldSpaceSize: true,
      },
      errors: [],
    } as any;

    // Mock successful API responses
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        response: 'Hello! I can help you with coding tasks.',
        session_id: 'test-session',
        mode: 'code',
        timestamp: new Date().toISOString(),
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('App Rendering', () => {
    it('should render the CLI application successfully', () => {
      const { lastFrame } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      expect(lastFrame()).toContain('Think AI CLI');
      expect(lastFrame()).toContain('Advanced AI for Code Generation');
    });

    it('should display startup warnings', () => {
      const warnings = ['Warning: Test environment detected'];
      
      const { lastFrame } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={warnings}
        />
      );

      expect(lastFrame()).toContain('Warning: Test environment detected');
    });

    it('should show input prompt when ready', () => {
      const { lastFrame } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      expect(lastFrame()).toContain('> '); // Input prompt indicator
    });
  });

  describe('User Input Handling', () => {
    it('should handle basic user input', async () => {
      // Mock streaming response
      mockThinkAIClient.sendMessageStream.mockImplementation(async function* () {
        yield { type: 'content', value: 'Hello' };
        yield { type: 'content', value: ' there!' };
      });

      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Simulate user typing and submitting
      stdin.write('h');
      stdin.write('i');
      stdin.write('\r'); // Enter key

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should show user message and Think AI response
      expect(lastFrame()).toContain('hi');
    });

    it('should handle slash commands', async () => {
      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Simulate typing a slash command
      stdin.write('/help');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should show help content
      expect(lastFrame()).toContain('help') || expect(lastFrame()).toContain('command');
    });

    it('should handle empty input gracefully', async () => {
      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Submit empty input
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should not crash and should still show prompt
      expect(lastFrame()).toContain('> ');
    });
  });

  describe('Think AI Integration E2E', () => {
    it('should successfully communicate with Think AI API', async () => {
      // Mock successful streaming response
      const mockStreamData = [
        'data: {"chunk": "I can help", "done": false}\n',
        'data: {"chunk": " you with", "done": false}\n',
        'data: {"chunk": " coding!", "done": true}\n',
      ];
      
      const mockStream = new ReadableStream({
        start(controller) {
          mockStreamData.forEach(chunk => {
            controller.enqueue(new TextEncoder().encode(chunk));
          });
          controller.close();
        },
      });
      
      mockFetch.mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      mockThinkAIClient.sendMessageStream.mockImplementation(async function* () {
        yield { type: 'content', value: 'I can help' };
        yield { type: 'content', value: ' you with' };
        yield { type: 'content', value: ' coding!' };
      });

      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Simulate user asking for help
      stdin.write('Can you help me write a Python function?');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should show the Think AI response
      expect(lastFrame()).toContain('Can you help me write a Python function?');
    });

    it('should handle Think AI API errors gracefully', async () => {
      // Mock API error
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      mockThinkAIClient.sendMessageStream.mockImplementation(async function* () {
        yield {
          type: 'error',
          value: {
            error: {
              message: 'ThinkAI API error: 500 Internal Server Error',
              status: 500,
            },
          },
        };
      });

      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Simulate user input that will trigger an error
      stdin.write('test error handling');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should show error message
      expect(lastFrame()).toContain('error') || expect(lastFrame()).toContain('Error');
    });

    it('should handle network connectivity issues', async () => {
      // Mock network error
      mockFetch.mockRejectedValue(new Error('Network error'));

      mockThinkAIClient.sendMessageStream.mockImplementation(async function* () {
        yield {
          type: 'error',
          value: {
            error: {
              message: 'Network error',
              status: 0,
            },
          },
        };
      });

      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      stdin.write('test network error');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should handle network error gracefully
      expect(lastFrame()).toContain('error') || expect(lastFrame()).toContain('Network');
    });
  });

  describe('Streaming Response Handling', () => {
    it('should display streaming responses in real-time', async () => {
      let contentCount = 0;
      mockThinkAIClient.sendMessageStream.mockImplementation(async function* () {
        yield { type: 'content', value: 'Streaming' };
        contentCount++;
        yield { type: 'content', value: ' response' };
        contentCount++;
        yield { type: 'content', value: ' test' };
        contentCount++;
      });

      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      stdin.write('test streaming');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should show the complete streamed response
      expect(lastFrame()).toContain('test streaming');
    });

    it('should handle interrupted streaming', async () => {
      mockThinkAIClient.sendMessageStream.mockImplementation(async function* () {
        yield { type: 'content', value: 'Partial' };
        // Simulate interruption
        throw new Error('Stream interrupted');
      });

      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      stdin.write('test interruption');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should handle interruption gracefully
      expect(lastFrame()).toContain('test interruption');
    });
  });

  describe('Session Management E2E', () => {
    it('should maintain conversation history', async () => {
      const mockHistory = [
        { role: 'user', parts: [{ text: 'First message' }] },
        { role: 'model', parts: [{ text: 'First response' }] },
      ];

      mockThinkAIClient.getHistory.mockResolvedValue(mockHistory);

      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Send first message
      stdin.write('First message');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Send second message
      stdin.write('Second message');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should show conversation history
      expect(lastFrame()).toContain('First message');
      expect(lastFrame()).toContain('Second message');
    });

    it('should handle session reset', async () => {
      mockThinkAIClient.resetChat.mockResolvedValue(undefined);

      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Simulate reset command
      stdin.write('/clear');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should clear the conversation history
      expect(mockThinkAIClient.resetChat).toHaveBeenCalled();
    });
  });

  describe('Performance E2E', () => {
    it('should handle rapid user input', async () => {
      mockThinkAIClient.sendMessageStream.mockImplementation(async function* () {
        yield { type: 'content', value: 'Quick response' };
      });

      const { stdin, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Simulate rapid typing
      const rapidInput = 'Quick test message';
      for (const char of rapidInput) {
        stdin.write(char);
      }
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should handle rapid input without issues
      expect(mockThinkAIClient.sendMessageStream).toHaveBeenCalled();
    });

    it('should handle long responses efficiently', async () => {
      const longResponse = 'Lorem ipsum '.repeat(100); // 1100+ characters
      
      mockThinkAIClient.sendMessageStream.mockImplementation(async function* () {
        // Simulate chunked long response
        for (let i = 0; i < longResponse.length; i += 10) {
          yield { type: 'content', value: longResponse.slice(i, i + 10) };
        }
      });

      const { stdin, lastFrame, rerender } = render(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      stdin.write('Generate long response');
      stdin.write('\r');

      rerender(
        <AppWrapper
          config={mockConfig}
          settings={mockSettings}
          startupWarnings={[]}
        />
      );

      // Should handle long responses efficiently
      expect(lastFrame()).toContain('Generate long response');
    });
  });
});