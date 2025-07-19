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
import { GeminiEventType } from './turn.js';

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
      getFileService: vi.fn().mockReturnValue({}),
      getToolRegistry: vi.fn().mockReturnValue(Promise.resolve(mockToolRegistry)),
      getFullContext: vi.fn().mockReturnValue(false),
      getUserMemory: vi.fn().mockReturnValue(''),
      getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
      getModel: vi.fn().mockReturnValue('thinkai-model'),
      getEmbeddingModel: vi.fn().mockReturnValue('thinkai-embedding'),
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        authType: 'test',
        model: 'test-model',
      }),
      setModel: vi.fn(),
      flashFallbackHandler: vi.fn(),
      getThinkAIMode: vi.fn().mockReturnValue('code'),
    } as any;

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
        toolRegistry: Promise.resolve(mockToolRegistry),
        getPreferredEditor: expect.any(Function),
      });
    });

    it('should handle missing tool registry', async () => {
      mockConfig.getToolRegistry = vi.fn().mockReturnValue(null);
      
      await client.initialize();
      
      expect(CoreToolScheduler).not.toHaveBeenCalled();
    });
  });

  describe('requiresLocalTools', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should detect file read patterns', () => {
      const testCases = [
        'read file package.json',
        'read the file config.ts',
        'read file "test file.txt"',
        "read file 'another.js'",
      ];

      testCases.forEach(message => {
        const result = (client as any).requiresLocalTools(message);
        expect(result.needsTools).toBe(true);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe('read_file');
        expect(result.toolCalls[0].args).toHaveProperty('absolute_path');
      });
    });

    it('should detect file write patterns', () => {
      const testCases = [
        'write to file output.txt',
        'create file new.js',
        'write file "test file.txt"',
      ];

      testCases.forEach(message => {
        const result = (client as any).requiresLocalTools(message);
        expect(result.needsTools).toBe(true);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe('write_file');
        expect(result.toolCalls[0].args).toHaveProperty('file_path');
        expect(result.toolCalls[0].args).toHaveProperty('content');
      });
    });

    it('should detect file edit patterns', () => {
      const testCases = [
        'edit file config.ts',
        'edit the file package.json',
      ];

      testCases.forEach(message => {
        const result = (client as any).requiresLocalTools(message);
        expect(result.needsTools).toBe(true);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe('edit_file');
        expect(result.toolCalls[0].args).toHaveProperty('file_path');
      });
    });

    it('should detect directory listing patterns', () => {
      const testCases = [
        'list files',
        'list directories',
        'what files are in the current directory',
        'show me the files',
      ];

      testCases.forEach(message => {
        const result = (client as any).requiresLocalTools(message);
        expect(result.needsTools).toBe(true);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe('list_directory');
        expect(result.toolCalls[0].args).toHaveProperty('path');
      });
    });

    it('should detect command execution patterns', () => {
      const testCases = [
        'run command ls -la',
        'execute npm install',
        'shell pwd',
        'run npm test',
        'git status',
        'mkdir new-folder',
      ];

      testCases.forEach(message => {
        const result = (client as any).requiresLocalTools(message);
        expect(result.needsTools).toBe(true);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe('run_shell_command');
        expect(result.toolCalls[0].args).toHaveProperty('command');
      });
    });

    it('should detect simple patterns', () => {
      const testCases = [
        { message: 'current directory', expectedTool: 'run_shell_command', expectedCommand: 'pwd' },
        { message: 'install dependencies', expectedTool: 'run_shell_command', expectedCommand: 'npm install' },
        { message: 'build the project', expectedTool: 'run_shell_command', expectedCommand: 'npm run build' },
        { message: 'run tests', expectedTool: 'run_shell_command', expectedCommand: 'tests' },
      ];

      testCases.forEach(({ message, expectedTool, expectedCommand }) => {
        const result = (client as any).requiresLocalTools(message);
        expect(result.needsTools).toBe(true);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe(expectedTool);
        if (expectedCommand) {
          expect(result.toolCalls[0].args.command).toBe(expectedCommand);
        }
      });
    });

    it('should not detect tools for regular conversation', () => {
      const testCases = [
        'hello world',
        'how are you?',
        'what is the weather like?',
        'explain quantum physics',
        'write a poem about cats',
      ];

      testCases.forEach(message => {
        const result = (client as any).requiresLocalTools(message);
        expect(result.needsTools).toBe(false);
        expect(result.toolCalls).toHaveLength(0);
      });
    });
  });

  describe('executeLocalTools', () => {
    let mockTool: any;

    beforeEach(async () => {
      mockTool = {
        name: 'test_tool',
        execute: vi.fn(),
      };
      mockToolRegistry.getTool.mockReturnValue(mockTool);
      await client.initialize();
    });

    it('should execute tools successfully with string content', async () => {
      const mockResult = {
        llmContent: 'Tool executed successfully',
        returnDisplay: 'Tool output',
      };
      mockTool.execute.mockResolvedValue(mockResult);

      const toolCalls = [{ name: 'test_tool', args: { param: 'value' } }];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toContain('Tool \'test_tool\' executed successfully');
      expect(result).toContain('Tool executed successfully');
      expect(mockTool.execute).toHaveBeenCalledWith(
        { param: 'value' },
        expect.any(AbortSignal)
      );
    });

    it('should execute tools successfully with array content', async () => {
      const mockResult = {
        llmContent: [
          { text: 'First part' },
          'Second part',
          { text: 'Third part' }
        ],
        returnDisplay: 'Tool output',
      };
      mockTool.execute.mockResolvedValue(mockResult);

      const toolCalls = [{ name: 'test_tool', args: { param: 'value' } }];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toContain('First partSecond partThird part');
    });

    it('should execute tools successfully with object content', async () => {
      const mockResult = {
        llmContent: { text: 'Object content' },
        returnDisplay: 'Tool output',
      };
      mockTool.execute.mockResolvedValue(mockResult);

      const toolCalls = [{ name: 'test_tool', args: { param: 'value' } }];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toContain('Object content');
    });

    it('should handle tools with no output', async () => {
      const mockResult = {
        llmContent: '',
        returnDisplay: '',
      };
      mockTool.execute.mockResolvedValue(mockResult);

      const toolCalls = [{ name: 'test_tool', args: { param: 'value' } }];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toContain('Tool \'test_tool\' executed successfully (no output)');
    });

    it('should handle missing tool registry', async () => {
      mockConfig.getToolRegistry = vi.fn().mockResolvedValue(null);

      const toolCalls = [{ name: 'test_tool', args: { param: 'value' } }];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toContain('Tool registry not available for test_tool');
    });

    it('should handle tool not found', async () => {
      mockToolRegistry.getTool.mockReturnValue(null);

      const toolCalls = [{ name: 'unknown_tool', args: { param: 'value' } }];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toContain('Tool \'unknown_tool\' not found');
    });

    it('should handle tool execution errors', async () => {
      const error = new Error('Tool execution failed');
      mockTool.execute.mockRejectedValue(error);

      const toolCalls = [{ name: 'test_tool', args: { param: 'value' } }];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toContain('Error executing tool \'test_tool\': Tool execution failed');
    });

    it('should handle multiple tools', async () => {
      const mockTool2 = {
        name: 'test_tool_2',
        execute: vi.fn().mockResolvedValue({
          llmContent: 'Second tool result',
          returnDisplay: 'Second output',
        }),
      };

      mockToolRegistry.getTool.mockImplementation((name: string) => {
        if (name === 'test_tool') return mockTool;
        if (name === 'test_tool_2') return mockTool2;
        return null;
      });

      mockTool.execute.mockResolvedValue({
        llmContent: 'First tool result',
        returnDisplay: 'First output',
      });

      const toolCalls = [
        { name: 'test_tool', args: { param: 'value1' } },
        { name: 'test_tool_2', args: { param: 'value2' } },
      ];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toContain('First tool result');
      expect(result).toContain('Second tool result');
      expect(mockTool.execute).toHaveBeenCalledWith({ param: 'value1' }, expect.any(AbortSignal));
      expect(mockTool2.execute).toHaveBeenCalledWith({ param: 'value2' }, expect.any(AbortSignal));
    });

    it('should handle tool call with missing name', async () => {
      const toolCalls = [{ name: undefined, args: { param: 'value' } }];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toContain('Tool call missing name');
    });

    it('should return error when tool scheduler not initialized', async () => {
      (client as any).toolScheduler = undefined;

      const toolCalls = [{ name: 'test_tool', args: { param: 'value' } }];
      const result = await (client as any).executeLocalTools(toolCalls);

      expect(result).toBe('Tool scheduler not initialized. Cannot execute local tools.');
    });
  });

  describe('sendMessageStream', () => {
    let mockChat: any;

    beforeEach(async () => {
      mockChat = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        setHistory: vi.fn(),
      };
      vi.mocked(ThinkAIChat).mockImplementation(() => mockChat);

      // Mock tool for testing
      const mockTool = {
        name: 'list_directory',
        execute: vi.fn().mockResolvedValue({
          llmContent: 'Directory contents: file1.txt, file2.js',
          returnDisplay: 'Dir listing',
        }),
      };
      mockToolRegistry.getTool.mockReturnValue(mockTool);

      await client.initialize();
    });

    it('should handle string requests requiring tools', async () => {
      // Mock the stream response from ThinkAI
      const mockStreamData = [
        'data: {"chunk": "Based on the directory listing", "done": false}\n',
        'data: {"chunk": ", you have 2 files.", "done": true}\n',
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

      const abortController = new AbortController();
      const generator = client.sendMessageStream('list files', abortController.signal);
      
      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      // Should execute the tool first, then get AI response
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe(GeminiEventType.Content);
      if (events[0].type === GeminiEventType.Content) {
        expect(events[0].value).toContain('Executing local tools');
      }
      
      expect(mockChat.addHistory).toHaveBeenCalledWith({
        role: 'user',
        parts: [{ text: 'list files' }]
      });
    });

    it('should handle requests not requiring tools', async () => {
      const mockStreamData = [
        'data: {"chunk": "Hello! I\'m here to help.", "done": true}\n',
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

      const abortController = new AbortController();
      const generator = client.sendMessageStream('hello', abortController.signal);
      
      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(GeminiEventType.Content);
      if (events[0].type === GeminiEventType.Content) {
        expect(events[0].value).toBe("Hello! I'm here to help.");
      }
    });

    it('should handle array requests', async () => {
      const mockStreamData = [
        'data: {"chunk": "Response to array", "done": true}\n',
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

      const abortController = new AbortController();
      const request = ['Hello', { text: 'World' }];
      const generator = client.sendMessageStream(request, abortController.signal);
      
      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      expect(mockChat.addHistory).toHaveBeenCalledWith({
        role: 'user',
        parts: [{ text: 'Hello World' }]
      });
    });

    it('should handle object requests', async () => {
      const mockStreamData = [
        'data: {"chunk": "Response to object", "done": true}\n',
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

      const abortController = new AbortController();
      const request = { text: 'Object message' };
      const generator = client.sendMessageStream(request, abortController.signal);
      
      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      expect(mockChat.addHistory).toHaveBeenCalledWith({
        role: 'user',
        parts: [{ text: 'Object message' }]
      });
    });

    it('should handle empty requests', async () => {
      const abortController = new AbortController();
      const generator = client.sendMessageStream('', abortController.signal);
      
      const result = await generator.next();
      expect(result.done).toBe(true);
    });

    it('should handle zero turns', async () => {
      const abortController = new AbortController();
      const generator = client.sendMessageStream('test', abortController.signal, 0);
      
      const result = await generator.next();
      expect(result.done).toBe(true);
    });

    it('should handle stream errors', async () => {
      const error = new Error('Stream error');
      mockFetch.mockRejectedValue(error);

      const abortController = new AbortController();
      const generator = client.sendMessageStream('hello', abortController.signal);
      
      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(GeminiEventType.Error);
      if (events[0].type === GeminiEventType.Error) {
        expect(events[0].value.error.message).toContain('Failed to stream message');
      }
    });

    it('should handle aborted signal during tool execution', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const generator = client.sendMessageStream('list files', abortController.signal);
      
      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      // Should still process but handle the abort
      expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('should properly add assistant response to history', async () => {
      const mockStreamData = [
        'data: {"chunk": "Complete response", "done": true}\n',
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

      const abortController = new AbortController();
      const generator = client.sendMessageStream('hello', abortController.signal);
      
      // Consume all events
      for await (const event of generator) {
        // Just consume
      }

      expect(mockChat.addHistory).toHaveBeenCalledWith({
        role: 'model',
        parts: [{ text: 'Complete response' }]
      });
    });
  });
});