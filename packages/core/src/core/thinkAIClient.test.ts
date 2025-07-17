/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThinkAIClient } from './thinkAIClient.js';
import { Config } from '../config/config.js';
import { ThinkAIChat } from './thinkAIChat.js';
import { reportError } from '../utils/errorReporting.js';
import { retryWithBackoff } from '../utils/retry.js';

// Mock dependencies
vi.mock('../utils/errorReporting.js');
vi.mock('../utils/retry.js');
vi.mock('../utils/getFolderStructure.js');
vi.mock('../tools/read-many-files.js');
vi.mock('./thinkAIChat.js');

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ThinkAIClient', () => {
  let mockConfig: Config;
  let client: ThinkAIClient;
  let mockReportError: any;
  let mockRetryWithBackoff: any;

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
        model: 'test-model',
      }),
      setModel: vi.fn(),
      flashFallbackHandler: vi.fn(),
    } as any;

    // Setup mocks
    mockReportError = vi.mocked(reportError);
    mockRetryWithBackoff = vi.mocked(retryWithBackoff);
    
    // Default retry behavior
    mockRetryWithBackoff.mockImplementation((fn: any) => fn());
    
    client = new ThinkAIClient(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default base URL', () => {
      const defaultClient = new ThinkAIClient(mockConfig);
      expect(defaultClient).toBeInstanceOf(ThinkAIClient);
    });

    it('should initialize with custom base URL', () => {
      const customClient = new ThinkAIClient(mockConfig, 'https://custom.api.com');
      expect(customClient).toBeInstanceOf(ThinkAIClient);
    });

    it('should generate a unique session ID', () => {
      const client1 = new ThinkAIClient(mockConfig);
      const client2 = new ThinkAIClient(mockConfig);
      
      // Access private sessionId via type assertion for testing
      const sessionId1 = (client1 as any).sessionId;
      const sessionId2 = (client2 as any).sessionId;
      
      expect(sessionId1).toBeTruthy();
      expect(sessionId2).toBeTruthy();
      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).toMatch(/^gemini-cli-\d+-[a-z0-9]+$/);
    });
  });

  describe('initialize', () => {
    it('should initialize chat successfully', async () => {
      const mockChat = {};
      vi.mocked(ThinkAIChat).mockImplementation(() => mockChat as any);
      
      await client.initialize();
      
      expect(client.getChat()).toBe(mockChat);
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Initialization failed');
      vi.mocked(ThinkAIChat).mockImplementation(() => {
        throw error;
      });
      
      await expect(client.initialize()).rejects.toThrow('Failed to initialize chat');
      expect(mockReportError).toHaveBeenCalledWith(
        error,
        'Error initializing ThinkAI chat session.',
        expect.any(Array),
        'startChat'
      );
    });
  });

  describe('makeRequest', () => {
    it('should make successful API request', async () => {
      const mockResponse = { response: 'Hello', session_id: 'test-session' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      
      const result = await (client as any).makeRequest('/test');
      
      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/test',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      
      await expect((client as any).makeRequest('/test')).rejects.toThrow(
        'ThinkAI API error: 500 Internal Server Error'
      );
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      mockFetch.mockRejectedValue(networkError);
      
      await expect((client as any).makeRequest('/test')).rejects.toThrow(networkError);
    });
  });

  describe('makeStreamRequest', () => {
    it('should make successful stream request', async () => {
      const mockStream = new ReadableStream();
      mockFetch.mockResolvedValue({
        ok: true,
        body: mockStream,
      });
      
      const result = await (client as any).makeStreamRequest('/test');
      
      expect(result).toBe(mockStream);
    });

    it('should handle stream API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });
      
      await expect((client as any).makeStreamRequest('/test')).rejects.toThrow(
        'ThinkAI API error: 400 Bad Request'
      );
    });
  });

  describe('sendMessage', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should send message successfully', async () => {
      const mockResponse = { response: 'Hello', session_id: 'test-session' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      
      const request = { message: 'Hello', session_id: 'test' };
      const result = await client.sendMessage(request);
      
      expect(result).toEqual(mockResponse);
      expect(mockRetryWithBackoff).toHaveBeenCalled();
    });

    it('should handle send message errors', async () => {
      const error = new Error('Send failed');
      mockFetch.mockRejectedValue(error);
      
      const request = { message: 'Hello', session_id: 'test' };
      await expect(client.sendMessage(request)).rejects.toThrow(error);
    });
  });

  describe('sendMessageToThinkAI', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should send message to ThinkAI successfully', async () => {
      const mockResponse = { response: 'Hello', session_id: 'test-session' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      
      const result = await client.sendMessageToThinkAI('Hello');
      
      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/chat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            message: 'Hello',
            session_id: expect.any(String),
            mode: 'code',
            use_web_search: false,
            fact_check: false,
          }),
        })
      );
    });

    it('should handle different modes', async () => {
      const mockResponse = { response: 'Hello', session_id: 'test-session' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      
      await client.sendMessageToThinkAI('Hello', 'general');
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/chat',
        expect.objectContaining({
          body: JSON.stringify({
            message: 'Hello',
            session_id: expect.any(String),
            mode: 'general',
            use_web_search: false,
            fact_check: false,
          }),
        })
      );
    });

    it('should handle send message errors and report them', async () => {
      const error = new Error('Send failed');
      mockFetch.mockRejectedValue(error);
      
      await expect(client.sendMessageToThinkAI('Hello')).rejects.toThrow(
        'Failed to send message'
      );
      
      expect(mockReportError).toHaveBeenCalledWith(
        error,
        'Error sending message to ThinkAI.',
        { message: 'Hello', mode: 'code' },
        'sendMessageToThinkAI'
      );
    });
  });

  describe('sendMessageStreamToThinkAI', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should stream message successfully', async () => {
      const mockStreamData = [
        'data: {"data": "Hello", "session_id": "test", "finished": false}\n',
        'data: {"data": " World", "session_id": "test", "finished": false}\n',
        'data: {"data": "!", "session_id": "test", "finished": true}\n',
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
      
      const results: string[] = [];
      const generator = client.sendMessageStreamToThinkAI('Hello');
      
      for await (const chunk of generator) {
        results.push(chunk);
      }
      
      expect(results).toEqual(['Hello', ' World', '!']);
    });

    it('should handle stream errors', async () => {
      const error = new Error('Stream failed');
      mockFetch.mockRejectedValue(error);
      
      const generator = client.sendMessageStreamToThinkAI('Hello');
      
      await expect(generator.next()).rejects.toThrow('Failed to stream message');
      expect(mockReportError).toHaveBeenCalledWith(
        error,
        'Error streaming message to ThinkAI.',
        { message: 'Hello', mode: 'code' },
        'sendMessageStreamToThinkAI'
      );
    });

    it('should handle malformed stream data gracefully', async () => {
      const mockStreamData = [
        'data: {"data": "Hello", "session_id": "test", "finished": false}\n',
        'data: invalid json\n',
        'data: {"data": "World", "session_id": "test", "finished": true}\n',
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
      
      const results: string[] = [];
      const generator = client.sendMessageStreamToThinkAI('Hello');
      
      for await (const chunk of generator) {
        results.push(chunk);
      }
      
      expect(results).toEqual(['Hello', 'World']);
    });
  });

  describe('session management', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should get sessions successfully', async () => {
      const mockSessions = [{ id: 'session1' }, { id: 'session2' }];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSessions),
      });
      
      const result = await client.getSessions();
      
      expect(result).toEqual(mockSessions);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/chat/sessions',
        expect.any(Object)
      );
    });

    it('should get session by ID successfully', async () => {
      const mockSession = { id: 'session1', messages: [] };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });
      
      const result = await client.getSession('session1');
      
      expect(result).toEqual(mockSession);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/chat/sessions/session1',
        expect.any(Object)
      );
    });

    it('should delete session successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      
      await client.deleteSession('session1');
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/chat/sessions/session1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should handle session management errors', async () => {
      const error = new Error('Session error');
      mockFetch.mockRejectedValue(error);
      
      await expect(client.getSessions()).rejects.toThrow('Failed to get sessions');
      await expect(client.getSession('test')).rejects.toThrow('Failed to get session');
      await expect(client.deleteSession('test')).rejects.toThrow('Failed to delete session');
    });
  });

  describe('knowledge base operations', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should search knowledge successfully', async () => {
      const mockResults = { results: ['result1', 'result2'] };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResults),
      });
      
      const result = await client.searchKnowledge('test query');
      
      expect(result).toEqual(mockResults);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/knowledge/search?q=test%20query',
        expect.any(Object)
      );
    });

    it('should get knowledge domains successfully', async () => {
      const mockDomains = ['domain1', 'domain2'];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDomains),
      });
      
      const result = await client.getKnowledgeDomains();
      
      expect(result).toEqual(mockDomains);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/knowledge/domains',
        expect.any(Object)
      );
    });

    it('should get knowledge stats successfully', async () => {
      const mockStats = { total: 100, domains: 5 };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStats),
      });
      
      const result = await client.getKnowledgeStats();
      
      expect(result).toEqual(mockStats);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/knowledge/stats',
        expect.any(Object)
      );
    });

    it('should handle knowledge operations errors', async () => {
      const error = new Error('Knowledge error');
      mockFetch.mockRejectedValue(error);
      
      await expect(client.searchKnowledge('test')).rejects.toThrow('Failed to search knowledge');
      await expect(client.getKnowledgeDomains()).rejects.toThrow('Failed to get knowledge domains');
      await expect(client.getKnowledgeStats()).rejects.toThrow('Failed to get knowledge stats');
    });
  });

  describe('healthCheck', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should perform health check successfully', async () => {
      const mockHealth = { status: 'healthy', uptime: 12345 };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      });
      
      const result = await client.healthCheck();
      
      expect(result).toEqual(mockHealth);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://thinkai.lat/api/health',
        expect.any(Object)
      );
    });

    it('should handle health check errors', async () => {
      const error = new Error('Health check failed');
      mockFetch.mockRejectedValue(error);
      
      await expect(client.healthCheck()).rejects.toThrow('Failed to check health');
      expect(mockReportError).toHaveBeenCalledWith(
        error,
        'Error checking ThinkAI health.',
        {},
        'healthCheck'
      );
    });
  });

  describe('chat management', () => {
    let mockChat: any;

    beforeEach(async () => {
      mockChat = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        setHistory: vi.fn(),
      };
      vi.mocked(ThinkAIChat).mockImplementation(() => mockChat);
      await client.initialize();
    });

    it('should get chat instance', () => {
      const chat = client.getChat();
      expect(chat).toBe(mockChat);
    });

    it('should throw error when chat not initialized', () => {
      const uninitializedClient = new ThinkAIClient(mockConfig);
      expect(() => uninitializedClient.getChat()).toThrow('Chat not initialized');
    });

    it('should add history to chat', async () => {
      const content = { role: 'user', parts: [{ text: 'Hello' }] };
      await client.addHistory(content);
      
      expect(mockChat.addHistory).toHaveBeenCalledWith(content);
    });

    it('should get history from chat', async () => {
      const mockHistory = [{ role: 'user', parts: [{ text: 'Hello' }] }];
      mockChat.getHistory.mockReturnValue(mockHistory);
      
      const history = await client.getHistory();
      
      expect(history).toEqual(mockHistory);
      expect(mockChat.getHistory).toHaveBeenCalled();
    });

    it('should set history on chat', async () => {
      const mockHistory = [{ role: 'user', parts: [{ text: 'Hello' }] }];
      await client.setHistory(mockHistory);
      
      expect(mockChat.setHistory).toHaveBeenCalledWith(mockHistory);
    });

    it('should reset chat successfully', async () => {
      await client.resetChat();
      
      expect(vi.mocked(ThinkAIChat)).toHaveBeenCalledTimes(2); // Once for initialize, once for reset
    });
  });

  describe('tryCompressChat', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should return null for compression (ThinkAI handles session management)', async () => {
      const result = await client.tryCompressChat();
      expect(result).toBeNull();
    });

    it('should return null for forced compression', async () => {
      const result = await client.tryCompressChat(true);
      expect(result).toBeNull();
    });
  });
});