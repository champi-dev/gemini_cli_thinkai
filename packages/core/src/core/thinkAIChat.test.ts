/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThinkAIChat } from './thinkAIChat.js';
import { ThinkAIClient } from './thinkAIClient.js';
import { Config } from '../config/config.js';
import { Content, SendMessageParameters } from '@google/genai';
import { logApiRequest, logApiResponse, logApiError } from '../telemetry/loggers.js';

// Mock dependencies
vi.mock('../telemetry/loggers.js');

describe('ThinkAIChat', () => {
  let mockConfig: Config;
  let mockClient: ThinkAIClient;
  let chat: ThinkAIChat;
  let mockLogApiRequest: any;
  let mockLogApiResponse: any;
  let mockLogApiError: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Setup config mock
    mockConfig = {
      getWorkingDir: vi.fn().mockReturnValue('/test/dir'),
      getFileService: vi.fn().mockReturnValue({}),
      getToolRegistry: vi.fn().mockReturnValue({
        getTool: vi.fn().mockReturnValue(null),
        getFunctionDeclarations: vi.fn().mockReturnValue([]),
      }),
      getFullContext: vi.fn().mockReturnValue(false),
      getUserMemory: vi.fn().mockReturnValue(''),
      getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
      getModel: vi.fn().mockReturnValue('thinkai-model'),
      getEmbeddingModel: vi.fn().mockReturnValue('thinkai-embedding'),
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        authType: 'test',
      }),
      setModel: vi.fn(),
      flashFallbackHandler: vi.fn(),
      getThinkAIMode: vi.fn().mockReturnValue('code'),
    } as any;

    // Setup client mock
    mockClient = {
      sendMessageToThinkAI: vi.fn(),
      sendMessageStreamToThinkAI: vi.fn(),
    } as any;

    // Setup telemetry mocks
    mockLogApiRequest = vi.mocked(logApiRequest);
    mockLogApiResponse = vi.mocked(logApiResponse);
    mockLogApiError = vi.mocked(logApiError);

    const sessionId = 'test-session-123';
    const chatConfig = {
      systemInstruction: 'You are a helpful assistant.',
      toolDeclarations: [],
    };

    chat = new ThinkAIChat(mockConfig, mockClient, sessionId, chatConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with valid parameters', () => {
      expect(chat).toBeInstanceOf(ThinkAIChat);
      expect(chat.getSessionId()).toBe('test-session-123');
    });

    it('should accept empty history', () => {
      const emptyChat = new ThinkAIChat(mockConfig, mockClient, 'session-id', {}, []);
      expect(emptyChat.getHistory()).toEqual([]);
    });

    it('should accept valid history', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
      ];
      
      const chatWithHistory = new ThinkAIChat(mockConfig, mockClient, 'session-id', {}, history);
      expect(chatWithHistory.getHistory()).toEqual(history);
    });

    it('should reject invalid history with wrong roles', () => {
      const invalidHistory: Content[] = [
        { role: 'invalid' as any, parts: [{ text: 'Hello' }] },
      ];
      
      expect(() => {
        new ThinkAIChat(mockConfig, mockClient, 'session-id', {}, invalidHistory);
      }).toThrow('Role must be user or model, but got invalid');
    });

    it('should use default config when not provided', () => {
      const defaultChat = new ThinkAIChat(mockConfig, mockClient, 'session-id');
      expect(defaultChat.getChatConfig()).toEqual({});
    });
  });

  describe('validateHistory', () => {
    it('should validate empty history', () => {
      // Should not throw
      expect(() => {
        (chat as any).validateHistory([]);
      }).not.toThrow();
    });

    it('should validate correct history', () => {
      const validHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi' }] },
      ];
      
      expect(() => {
        (chat as any).validateHistory(validHistory);
      }).not.toThrow();
    });

    it('should reject invalid roles', () => {
      const invalidHistory: Content[] = [
        { role: 'system' as any, parts: [{ text: 'Hello' }] },
      ];
      
      expect(() => {
        (chat as any).validateHistory(invalidHistory);
      }).toThrow('Role must be user or model, but got system');
    });
  });

  describe('isValidContent', () => {
    it('should validate content with text', () => {
      const content: Content = {
        role: 'user',
        parts: [{ text: 'Hello world' }],
      };
      
      expect((chat as any).isValidContent(content)).toBe(true);
    });

    it('should reject content with empty parts', () => {
      const content: Content = {
        role: 'user',
        parts: [],
      };
      
      expect((chat as any).isValidContent(content)).toBe(false);
    });

    it('should reject content with undefined parts', () => {
      const content: Content = {
        role: 'user',
        parts: undefined as any,
      };
      
      expect((chat as any).isValidContent(content)).toBe(false);
    });

    it('should reject content with empty text', () => {
      const content: Content = {
        role: 'user',
        parts: [{ text: '' }],
      };
      
      expect((chat as any).isValidContent(content)).toBe(false);
    });

    it('should reject content with empty parts object', () => {
      const content: Content = {
        role: 'user',
        parts: [{}],
      };
      
      expect((chat as any).isValidContent(content)).toBe(false);
    });
  });

  describe('extractCuratedHistory', () => {
    it('should handle empty history', () => {
      const result = (chat as any).extractCuratedHistory([]);
      expect(result).toEqual([]);
    });

    it('should preserve valid user-model alternation', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
        { role: 'model', parts: [{ text: 'I am fine' }] },
      ];
      
      const result = (chat as any).extractCuratedHistory(history);
      expect(result).toEqual(history);
    });

    it('should remove invalid model responses and corresponding user input', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: '' }] }, // Invalid
        { role: 'user', parts: [{ text: 'How are you?' }] },
        { role: 'model', parts: [{ text: 'I am fine' }] },
      ];
      
      const result = (chat as any).extractCuratedHistory(history);
      expect(result).toEqual([
        { role: 'user', parts: [{ text: 'How are you?' }] },
        { role: 'model', parts: [{ text: 'I am fine' }] },
      ]);
    });
  });

  describe('convertHistoryToMessage', () => {
    it('should convert empty history with system instruction', () => {
      const chatWithInstruction = new ThinkAIChat(
        mockConfig,
        mockClient,
        'session-id',
        { systemInstruction: 'You are helpful' },
        []
      );
      
      const result = (chatWithInstruction as any).convertHistoryToMessage();
      expect(result).toBe('You are helpful');
    });

    it('should convert history with conversations', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
      ];
      
      const chatWithHistory = new ThinkAIChat(
        mockConfig,
        mockClient,
        'session-id',
        { systemInstruction: 'You are helpful' },
        history
      );
      
      const result = (chatWithHistory as any).convertHistoryToMessage();
      expect(result).toBe('You are helpful\n\nHuman: Hello\n\nAssistant: Hi there!');
    });

    it('should handle multiple parts in content', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }, { text: ' world' }] },
      ];
      
      const chatWithHistory = new ThinkAIChat(
        mockConfig,
        mockClient,
        'session-id',
        {},
        history
      );
      
      const result = (chatWithHistory as any).convertHistoryToMessage();
      expect(result).toBe('Human: Hello  world');
    });
  });

  describe('convertThinkAIResponseToGemini', () => {
    it('should convert response without usage metadata', () => {
      const result = (chat as any).convertThinkAIResponseToGemini('Hello world');
      
      expect(result).toEqual({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Hello world' }],
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: undefined,
      });
    });

    it('should convert response with usage metadata', () => {
      const usageMetadata = {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      };
      
      const result = (chat as any).convertThinkAIResponseToGemini('Hello world', usageMetadata);
      
      expect(result).toEqual({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Hello world' }],
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30,
        },
      });
    });
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      const mockThinkAIResponse = {
        response: 'Hello there!',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };
      
      mockClient.sendMessageToThinkAI = vi.fn().mockResolvedValue(mockThinkAIResponse);
      
      const params: SendMessageParameters = {
        message: 'Hello',
      };
      
      const result = await chat.sendMessage(params);
      
      expect(result.candidates?.[0]?.content?.parts?.[0]?.text).toBe('Hello there!');
      expect(result.usageMetadata).toEqual({
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      });
      
      expect(mockClient.sendMessageToThinkAI).toHaveBeenCalledWith(
        'You are a helpful assistant.\n\nHuman: Hello',
        'code'
      );
      
      expect(mockLogApiRequest).toHaveBeenCalled();
      expect(mockLogApiResponse).toHaveBeenCalled();
    });

    it('should handle send message errors', async () => {
      const error = new Error('Send failed');
      mockClient.sendMessageToThinkAI = vi.fn().mockRejectedValue(error);
      
      const params: SendMessageParameters = {
        message: 'Hello',
      };
      
      await expect(chat.sendMessage(params)).rejects.toThrow(error);
      
      expect(mockLogApiRequest).toHaveBeenCalled();
      expect(mockLogApiError).toHaveBeenCalled();
    });

    it('should add and remove user message from history on error', async () => {
      const error = new Error('Send failed');
      mockClient.sendMessageToThinkAI = vi.fn().mockRejectedValue(error);
      
      const initialHistory = chat.getHistory();
      
      const params: SendMessageParameters = {
        message: 'Hello',
      };
      
      await expect(chat.sendMessage(params)).rejects.toThrow(error);
      
      // History should be the same as before (user message removed on error)
      expect(chat.getHistory()).toEqual(initialHistory);
    });

    it('should update history on successful send', async () => {
      const mockThinkAIResponse = {
        response: 'Hello there!',
        usage: undefined,
      };
      
      mockClient.sendMessageToThinkAI = vi.fn().mockResolvedValue(mockThinkAIResponse);
      
      const params: SendMessageParameters = {
        message: 'Hello',
      };
      
      await chat.sendMessage(params);
      
      const history = chat.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].parts?.[0]?.text).toBe('Hello');
      expect(history[1].role).toBe('model');
      expect(history[1].parts?.[0]?.text).toBe('Hello there!');
    });
  });

  describe('sendMessageStream', () => {
    it('should stream message successfully', async () => {
      const mockStreamData = ['Hello', ' there', '!'];
      
      async function* mockStream() {
        for (const chunk of mockStreamData) {
          yield chunk;
        }
      }
      
      mockClient.sendMessageStreamToThinkAI = vi.fn().mockReturnValue(mockStream());
      
      const params: SendMessageParameters = {
        message: 'Hello',
      };
      
      const generator = await chat.sendMessageStream(params);
      const chunks = [];
      
      for await (const chunk of generator) {
        chunks.push(chunk);
      }
      
      expect(chunks).toHaveLength(3);
      expect(chunks[0].candidates?.[0]?.content?.parts?.[0]?.text).toBe('Hello');
      expect(chunks[1].candidates?.[0]?.content?.parts?.[0]?.text).toBe(' there');
      expect(chunks[2].candidates?.[0]?.content?.parts?.[0]?.text).toBe('!');
      
      expect(mockClient.sendMessageStreamToThinkAI).toHaveBeenCalledWith(
        'You are a helpful assistant.\n\nHuman: Hello',
        'code'
      );
      
      expect(mockLogApiRequest).toHaveBeenCalled();
      expect(mockLogApiResponse).toHaveBeenCalled();
    });

    it('should handle stream errors', async () => {
      const error = new Error('Stream failed');
      
      async function* mockStreamError() {
        throw error;
      }
      
      mockClient.sendMessageStreamToThinkAI = vi.fn().mockReturnValue(mockStreamError());
      
      const params: SendMessageParameters = {
        message: 'Hello',
      };
      
      const generator = await chat.sendMessageStream(params);
      
      await expect(generator.next()).rejects.toThrow(error);
      
      expect(mockLogApiRequest).toHaveBeenCalled();
      expect(mockLogApiError).toHaveBeenCalled();
    });

    it('should update history after streaming completes', async () => {
      const mockStreamData = ['Hello', ' there', '!'];
      
      async function* mockStream() {
        for (const chunk of mockStreamData) {
          yield chunk;
        }
      }
      
      mockClient.sendMessageStreamToThinkAI = vi.fn().mockReturnValue(mockStream());
      
      const params: SendMessageParameters = {
        message: 'Hello',
      };
      
      const generator = await chat.sendMessageStream(params);
      
      // Consume all chunks
      for await (const chunk of generator) {
        // Just consume
      }
      
      const history = chat.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].parts?.[0]?.text).toBe('Hello');
      expect(history[1].role).toBe('model');
      expect(history[1].parts?.[0]?.text).toBe('Hello there!');
    });
  });

  describe('history management', () => {
    it('should get history correctly', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi' }] },
      ];
      
      chat.setHistory(history);
      
      expect(chat.getHistory()).toEqual(history);
    });

    it('should get curated history', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: '' }] }, // Invalid
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello' }] },
      ];
      
      chat.setHistory(history);
      
      const curated = chat.getHistory(true);
      expect(curated).toEqual([
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello' }] },
      ]);
    });

    it('should clear history', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi' }] },
      ];
      
      chat.setHistory(history);
      chat.clearHistory();
      
      expect(chat.getHistory()).toEqual([]);
    });

    it('should add history entry', () => {
      const newContent: Content = {
        role: 'user',
        parts: [{ text: 'New message' }],
      };
      
      chat.addHistory(newContent);
      
      const history = chat.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(newContent);
    });

    it('should set history with validation', () => {
      const validHistory: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi' }] },
      ];
      
      chat.setHistory(validHistory);
      expect(chat.getHistory()).toEqual(validHistory);
    });

    it('should reject invalid history when setting', () => {
      const invalidHistory: Content[] = [
        { role: 'invalid' as any, parts: [{ text: 'Hello' }] },
      ];
      
      expect(() => {
        chat.setHistory(invalidHistory);
      }).toThrow('Role must be user or model, but got invalid');
    });

    it('should return deep copy of history', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
      ];
      
      chat.setHistory(history);
      const retrievedHistory = chat.getHistory();
      
      // Modify the retrieved history
      retrievedHistory[0].parts![0].text = 'Modified';
      
      // Original should not be affected
      expect(chat.getHistory()[0].parts![0].text).toBe('Hello');
    });
  });

  describe('accessors', () => {
    it('should get session ID', () => {
      expect(chat.getSessionId()).toBe('test-session-123');
    });

    it('should get chat config', () => {
      const config = {
        systemInstruction: 'You are helpful',
        toolDeclarations: ['tool1', 'tool2'],
      };
      
      const configuredChat = new ThinkAIChat(
        mockConfig,
        mockClient,
        'session-id',
        config
      );
      
      expect(configuredChat.getChatConfig()).toEqual(config);
    });
  });

  describe('recordHistory', () => {
    it('should record valid model output', () => {
      const userInput: Content = { role: 'user', parts: [{ text: 'Hello' }] };
      const modelOutput: Content[] = [{ role: 'model', parts: [{ text: 'Hi' }] }];
      
      // Add user input first (as done in real usage)
      chat.addHistory(userInput);
      (chat as any).recordHistory(userInput, modelOutput);
      
      const history = chat.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(userInput);
      expect(history[1]).toEqual(modelOutput[0]);
    });

    it('should filter out invalid model output', () => {
      const userInput: Content = { role: 'user', parts: [{ text: 'Hello' }] };
      const modelOutput: Content[] = [
        { role: 'model', parts: [{ text: '' }] }, // Invalid
        { role: 'model', parts: [{ text: 'Hi' }] }, // Valid
      ];
      
      // Add user input first (as done in real usage)
      chat.addHistory(userInput);
      (chat as any).recordHistory(userInput, modelOutput);
      
      const history = chat.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(userInput);
      expect(history[1]).toEqual(modelOutput[1]);
    });

    it('should handle empty model output', () => {
      const userInput: Content = { role: 'user', parts: [{ text: 'Hello' }] };
      const modelOutput: Content[] = [];
      
      // Add user input first (as done in real usage)
      chat.addHistory(userInput);
      (chat as any).recordHistory(userInput, modelOutput);
      
      const history = chat.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(userInput);
    });
  });

  describe('getFinalUsageMetadata', () => {
    it('should return metadata from last chunk with metadata', () => {
      const chunks = [
        { usageMetadata: undefined },
        { usageMetadata: { totalTokenCount: 10 } },
        { usageMetadata: undefined },
        { usageMetadata: { totalTokenCount: 20 } },
      ];
      
      const result = (chat as any).getFinalUsageMetadata(chunks);
      expect(result).toEqual({ totalTokenCount: 20 });
    });

    it('should return undefined when no chunks have metadata', () => {
      const chunks = [
        { usageMetadata: undefined },
        { usageMetadata: undefined },
      ];
      
      const result = (chat as any).getFinalUsageMetadata(chunks);
      expect(result).toBeUndefined();
    });

    it('should handle empty chunks array', () => {
      const result = (chat as any).getFinalUsageMetadata([]);
      expect(result).toBeUndefined();
    });
  });
});