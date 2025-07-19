/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgenticThinkAIClient } from './agenticThinkAIClient.js';
import { Config } from '../config/config.js';
import { ThinkAIChat } from './thinkAIChat.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { GeminiEventType, Turn } from './turn.js';

// Mock dependencies
vi.mock('./thinkAIChat.js');
vi.mock('./coreToolScheduler.js');
vi.mock('../utils/errorReporting.js');
vi.mock('../utils/retry.js');
vi.mock('../utils/getFolderStructure.js');
vi.mock('../tools/read-many-files.js');

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AgenticThinkAIClient', () => {
  let mockConfig: Config;
  let client: AgenticThinkAIClient;
  let mockToolRegistry: any;
  let mockToolScheduler: any;
  let mockBaseClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup tool registry mock
    mockToolRegistry = {
      getTool: vi.fn(),
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
    };
    
    // Setup tool scheduler mock
    mockToolScheduler = {
      schedule: vi.fn(),
      getToolCalls: vi.fn().mockReturnValue([]),
    };
    vi.mocked(CoreToolScheduler).mockImplementation(() => mockToolScheduler);
    
    // Setup config mock
    mockConfig = {
      getWorkingDir: vi.fn().mockReturnValue('/test/dir'),
      getToolRegistry: vi.fn().mockReturnValue(Promise.resolve(mockToolRegistry)),
      getToolsEnabled: vi.fn().mockReturnValue(true),
      getHttpProxy: vi.fn().mockReturnValue(undefined),
      getSessionId: vi.fn().mockReturnValue('test-session'),
      getDryRun: vi.fn().mockReturnValue(false),
      getPomptomConfig: vi.fn().mockReturnValue({
        apiKey: 'test-key',
        authType: 'test',
        model: 'test-model',
      }),
      setModel: vi.fn(),
      flashFallbackHandler: vi.fn(),
      getThinkAIMode: vi.fn().mockReturnValue('code'),
    } as any;

    // Setup base client mock that will be used after initialize
    mockBaseClient = {
      sendMessageToThinkAI: vi.fn().mockRejectedValue(new Error('AI parsing failed')),
      getChat: vi.fn().mockReturnValue({
        getHistory: vi.fn().mockReturnValue([])
      }),
      initialize: vi.fn().mockResolvedValue(undefined)
    };
    
    // Mock the dynamic import
    vi.doMock('./thinkAIClient.js', () => ({
      ThinkAIClient: vi.fn().mockImplementation(() => mockBaseClient)
    }));

    client = new AgenticThinkAIClient(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with config and base URL', () => {
      const customClient = new AgenticThinkAIClient(mockConfig, 'https://custom.api.com');
      expect(customClient).toBeInstanceOf(AgenticThinkAIClient);
      expect((customClient as any).agenticConfig).toBe(mockConfig);
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      // Mock ThinkAIChat initialization
      vi.mocked(ThinkAIChat).mockImplementation(() => ({
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        setHistory: vi.fn(),
      }) as any);
    });

    it('should initialize with tool scheduler', async () => {
      await client.initialize();
      
      expect(mockConfig.getToolRegistry).toHaveBeenCalled();
      expect(CoreToolScheduler).toHaveBeenCalledWith({
        config: mockConfig,
        toolRegistry: mockToolRegistry,
        getPreferredEditor: expect.any(Function),
      });
    });

    it('should handle missing tool registry', async () => {
      mockConfig.getToolRegistry = vi.fn().mockReturnValue(null);
      
      await client.initialize();
      
      expect(CoreToolScheduler).not.toHaveBeenCalled();
    });
  });

  describe('parseUserIntent and fallbackPatternMatching', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should detect golang server creation', async () => {
      // Since AI parsing fails, it should fall back to pattern matching
      const result = await (client as any).parseUserIntent('write a simple golang server for hello world');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('write_file');
      expect(result.toolCalls[0].args.file_path).toContain('server.go');
      expect(result.toolCalls[0].args.content).toContain('package main');
      expect(result.toolCalls[0].args.content).toContain('Hello World');
    });

    it('should detect python server creation', async () => {
      const result = await (client as any).parseUserIntent('create a python flask server');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('write_file');
      expect(result.toolCalls[0].args.file_path).toContain('.py');
      expect(result.toolCalls[0].args.content).toContain('from flask import Flask');
    });

    it('should detect node.js server creation', async () => {
      const result = await (client as any).parseUserIntent('write a node.js express server');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('write_file');
      expect(result.toolCalls[0].args.file_path).toContain('server.js');
      expect(result.toolCalls[0].args.content).toContain('const http = require');
    });

    it('should handle questions without tools', async () => {
      const result = await (client as any).parseUserIntent('how do I install node.js?');
      
      expect(result.needsTools).toBe(false);
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle compound actions', async () => {
      const result = await (client as any).parseUserIntent('write a golang server and execute it');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('write_file');
      expect(result.toolCalls[0].args.file_path).toContain('server.go');
      expect(result.toolCalls[1].name).toBe('run_shell_command');
      expect(result.toolCalls[1].args.command).toContain('go run');
    });

    it('should handle run it commands with context', async () => {
      // Mock chat history to have a previous go file creation
      mockBaseClient.getChat.mockReturnValue({
        getHistory: vi.fn().mockReturnValue([
          { role: 'user', parts: [{ text: 'write a golang server' }] },
          { role: 'assistant', parts: [{ text: 'Created server.go' }] }
        ])
      });
      
      const result = await (client as any).parseUserIntent('run it');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('run_shell_command');
      expect(result.toolCalls[0].args.command).toContain('go run');
    });
  });

  describe('selectMode', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should select general mode for questions', async () => {
      mockBaseClient.sendMessageToThinkAI.mockResolvedValueOnce({ 
        response: 'general' 
      });
      
      const mode = await (client as any).selectMode('how do I test it locally?');
      expect(mode).toBe('general');
    });

    it('should default to general on error', async () => {
      mockBaseClient.sendMessageToThinkAI.mockRejectedValueOnce(new Error('API error'));
      
      const mode = await (client as any).selectMode('any message');
      expect(mode).toBe('general');
    });
  });

  describe('sendMessageToThinkAI', () => {
    beforeEach(async () => {
      await client.initialize();
      // Mock chat
      const mockChat = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        setHistory: vi.fn(),
      };
      vi.mocked(ThinkAIChat).mockImplementation(() => mockChat as any);
    });

    it('should handle file creation request', async () => {
      const message = 'write a simple golang server';
      
      // Mock AI to return instructions - this should trigger extraction
      mockBaseClient.sendMessageToThinkAI.mockResolvedValueOnce({
        response: 'Here is a simple Go server:\n```go\npackage main\n\nimport "net/http"\n\nfunc main() {\n  http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {\n    w.Write([]byte("Hello World!"))\n  })\n  http.ListenAndServe(":8080", nil)\n}\n```\nSave this to main.go',
        session_id: 'test',
        mode: 'code',
        timestamp: new Date().toISOString()
      });
      
      const result = await client.sendMessageToThinkAI(message);
      
      expect(result.response).toContain('package main');
      expect(mockBaseClient.sendMessageToThinkAI).toHaveBeenCalledWith(message, 'code');
    });

    it('should handle regular conversation', async () => {
      const message = 'what is typescript?';
      
      // Mock AI response for general mode
      mockBaseClient.sendMessageToThinkAI.mockResolvedValueOnce({
        response: 'TypeScript is a typed superset of JavaScript...',
        session_id: 'test',
        mode: 'general',
        timestamp: new Date().toISOString()
      });
      
      const result = await client.sendMessageToThinkAI(message);
      
      expect(result.response).toContain('TypeScript is a typed superset');
    });

    it('should handle streaming responses', async () => {
      const message = 'explain node.js';
      
      // Mock streaming response
      mockBaseClient.sendMessageStreamToThinkAI.mockImplementationOnce(async function* () {
        yield 'Node.js is ';
        yield 'a JavaScript runtime';
      });
      
      const chunks: string[] = [];
      const stream = client.sendMessageStreamToThinkAI(message, 'general');
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      
      expect(chunks).toContain('Node.js is ');
      expect(chunks).toContain('a JavaScript runtime');
    });
  });

  describe('sendMessageStream', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should stream tool execution events', async () => {
      const events: any[] = [];
      const signal = new AbortController().signal;
      const generator = client.sendMessageStream('create a server.js file', signal);
      
      // Mock AI response that should be parsed
      mockBaseClient.sendMessageStreamToThinkAI.mockImplementationOnce(async function* () {
        yield 'Creating a server.js file...';
      });
      
      for await (const event of generator) {
        events.push(event);
        if (events.length > 10) break; // Prevent infinite loop
      }
      
      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === GeminiEventType.Content)).toBe(true);
    });
  });
});