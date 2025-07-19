/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThinkAIClient } from './thinkAIClient.js';
import { ThinkAIChat } from './thinkAIChat.js';
import { Config } from '../config/config.js';
import { createAutoDetectedClient, ClientType, configureThinkAI } from './clientFactory.js';

// Mock fetch globally for integration tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ThinkAI Integration Tests', () => {
  let mockConfig: Config;
  let client: ThinkAIClient;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Clear environment variables
    delete process.env.THINKAI_BASE_URL;
    delete process.env.USE_THINKAI;
    
    // Setup config mock
    mockConfig = {
      getWorkingDir: vi.fn().mockReturnValue('/test/integration'),
      getFileService: vi.fn().mockReturnValue({
        readFile: vi.fn(),
        writeFile: vi.fn(),
        exists: vi.fn().mockReturnValue(true),
      }),
      getToolRegistry: vi.fn().mockReturnValue({
        getTool: vi.fn().mockReturnValue(null),
        getFunctionDeclarations: vi.fn().mockReturnValue([
          {
            name: 'test_tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              properties: {
                input: { type: 'string' },
              },
            },
          },
        ]),
      }),
      getFullContext: vi.fn().mockReturnValue(false),
      getUserMemory: vi.fn().mockReturnValue('User preferences: testing mode'),
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        authType: 'test',
      }),
      getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
      getModel: vi.fn().mockReturnValue('thinkai-model'),
      getEmbeddingModel: vi.fn().mockReturnValue('thinkai-embedding'),
      setModel: vi.fn(),
      flashFallbackHandler: vi.fn(),
    } as any;

    client = new ThinkAIClient(mockConfig, 'https://test.thinkai.com/api');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    
    // Clean up environment variables
    delete process.env.THINKAI_BASE_URL;
    delete process.env.USE_THINKAI;
  });

  describe('Client and Chat Integration', () => {
    it('should initialize client and chat together', async () => {
      // Mock the fetch calls for initialization
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy' }),
      });

      await client.initialize();
      
      const chat = client.getChat();
      expect(chat).toBeInstanceOf(ThinkAIChat);
      expect(chat.getSessionId()).toMatch(/^gemini-cli-\d+-[a-z0-9]+$/);
    });

    it('should handle full conversation flow', async () => {
      // Mock successful responses
      const mockResponses = [
        { response: 'Hello! How can I help you?', session_id: 'test-session' },
        { response: 'I can help with that task.', session_id: 'test-session' },
      ];

      let callCount = 0;
      mockFetch.mockImplementation(() => {
        const response = mockResponses[callCount] || mockResponses[0];
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
        });
      });

      await client.initialize();
      const chat = client.getChat();

      // Send first message
      const response1 = await chat.sendMessage({ message: 'Hello' });
      expect(response1.candidates?.[0]?.content?.parts?.[0]?.text).toBe('Hello! How can I help you?');

      // Send second message
      const response2 = await chat.sendMessage({ message: 'Help me with a task' });
      expect(response2.candidates?.[0]?.content?.parts?.[0]?.text).toBe('I can help with that task.');

      // Check history
      const history = chat.getHistory();
      expect(history).toHaveLength(6); // 2 user messages + 2 model responses + system setup
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('model');
      expect(history[2].role).toBe('user');
      expect(history[3].role).toBe('model');
    });

    it('should handle streaming conversation', async () => {
      const mockStreamData = [
        'data: {"chunk": "Hello", "done": false}\n',
        'data: {"chunk": "! How can", "done": false}\n',
        'data: {"chunk": " I help you?", "done": true}\n',
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

      await client.initialize();
      const chat = client.getChat();

      const generator = await chat.sendMessageStream({ message: 'Hello' });
      const chunks = [];

      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0].candidates?.[0]?.content?.parts?.[0]?.text).toBe('Hello');
      expect(chunks[1].candidates?.[0]?.content?.parts?.[0]?.text).toBe('! How can');
      expect(chunks[2].candidates?.[0]?.content?.parts?.[0]?.text).toBe(' I help you?');

      // Check final history
      const history = chat.getHistory();
      expect(history).toHaveLength(2);
      expect(history[1].parts?.[0]?.text).toBe('Hello! How can I help you?');
    });

    it('should handle errors gracefully during conversation', async () => {
      // Mock successful initialization
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy' }),
      });

      await client.initialize();
      const chat = client.getChat();

      // Mock error response
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(chat.sendMessage({ message: 'Hello' })).rejects.toThrow('Network error');

      // History should remain clean (no partial messages)
      const history = chat.getHistory();
      expect(history).toHaveLength(0);
    });

    it('should handle session management operations', async () => {
      const mockSessions = [
        { id: 'session1', created: '2023-01-01' },
        { id: 'session2', created: '2023-01-02' },
      ];

      const mockSession = {
        id: 'session1',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
      };

      let callCount = 0;
      mockFetch.mockImplementation((url) => {
        if (url.includes('/chat/sessions') && !url.includes('/session')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSessions),
          });
        }
        if (url.includes('/chat/sessions/session1')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSession),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      await client.initialize();

      // Test get sessions
      const sessions = await client.getSessions();
      expect(sessions).toEqual(mockSessions);

      // Test get specific session
      const session = await client.getSession('session1');
      expect(session).toEqual(mockSession);

      // Test delete session
      await expect(client.deleteSession('session1')).resolves.toBeUndefined();
    });

    it('should handle knowledge base operations', async () => {
      const mockSearchResults = {
        results: [
          { title: 'Result 1', content: 'Content 1' },
          { title: 'Result 2', content: 'Content 2' },
        ],
      };

      const mockDomains = ['technology', 'science', 'general'];
      const mockStats = { total_entries: 10000, domains: 3 };

      mockFetch.mockImplementation((url) => {
        if (url.includes('/knowledge/search')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSearchResults),
          });
        }
        if (url.includes('/knowledge/domains')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockDomains),
          });
        }
        if (url.includes('/knowledge/stats')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockStats),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      await client.initialize();

      // Test search
      const searchResults = await client.searchKnowledge('test query');
      expect(searchResults).toEqual(mockSearchResults);

      // Test get domains
      const domains = await client.getKnowledgeDomains();
      expect(domains).toEqual(mockDomains);

      // Test get stats
      const stats = await client.getKnowledgeStats();
      expect(stats).toEqual(mockStats);
    });
  });

  describe('Factory Integration', () => {
    it('should create ThinkAI client through factory', async () => {
      configureThinkAI('https://test.thinkai.com/api');

      // Mock successful health check
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy' }),
      });

      const autoClient = await createAutoDetectedClient(mockConfig);
      
      expect(autoClient).toBeInstanceOf(ThinkAIClient);
      expect(process.env.USE_THINKAI).toBe('true');
      expect(process.env.THINKAI_BASE_URL).toBe('https://test.thinkai.com/api');
    });

    it('should handle client switching', async () => {
      // Start with Gemini (default)
      let clientType = ClientType.GEMINI;
      
      // Switch to ThinkAI
      configureThinkAI('https://test.thinkai.com/api');
      clientType = ClientType.THINKAI;
      
      expect(clientType).toBe(ClientType.THINKAI);
      expect(process.env.USE_THINKAI).toBe('true');
      
      // Switch back to Gemini
      configureThinkAI(undefined, false);
      clientType = ClientType.GEMINI;
      
      expect(clientType).toBe(ClientType.GEMINI);
      expect(process.env.USE_THINKAI).toBeUndefined();
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle network failures gracefully', async () => {
      // Mock network failure
      mockFetch.mockRejectedValue(new Error('Network failure'));

      await expect(client.initialize()).rejects.toThrow();
    });

    it('should handle API errors gracefully', async () => {
      // Mock API error
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.initialize()).rejects.toThrow('ThinkAI API error: 500 Internal Server Error');
    });

    it('should handle malformed responses gracefully', async () => {
      // Mock malformed response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(client.initialize()).rejects.toThrow('Invalid JSON');
    });
  });

  describe('Performance Integration', () => {
    it('should handle concurrent requests', async () => {
      const mockResponses = [
        { response: 'Response 1', session_id: 'test-session' },
        { response: 'Response 2', session_id: 'test-session' },
        { response: 'Response 3', session_id: 'test-session' },
      ];

      let callCount = 0;
      mockFetch.mockImplementation(() => {
        const response = mockResponses[callCount % mockResponses.length];
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
        });
      });

      await client.initialize();
      const chat = client.getChat();

      // Send multiple concurrent requests
      const promises = [
        chat.sendMessage({ message: 'Message 1' }),
        chat.sendMessage({ message: 'Message 2' }),
        chat.sendMessage({ message: 'Message 3' }),
      ];

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.candidates?.[0]?.content?.parts?.[0]?.text).toBe(`Response ${index + 1}`);
      });
    });

    it('should handle large conversation history', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ response: 'OK', session_id: 'test' }),
      });

      await client.initialize();
      const chat = client.getChat();

      // Build large history
      const largeHistory = [];
      for (let i = 0; i < 100; i++) {
        largeHistory.push({ role: 'user', parts: [{ text: `Message ${i}` }] });
        largeHistory.push({ role: 'model', parts: [{ text: `Response ${i}` }] });
      }

      chat.setHistory(largeHistory);

      // Send new message
      const response = await chat.sendMessage({ message: 'New message' });
      expect(response.candidates?.[0]?.content?.parts?.[0]?.text).toBe('OK');

      // Verify history length
      const finalHistory = chat.getHistory();
      expect(finalHistory.length).toBe(102); // 100 + 2 new messages
    });
  });

  describe('Configuration Integration', () => {
    it('should respect full context setting', async () => {
      // Enable full context
      mockConfig.getFullContext = vi.fn().mockReturnValue(true);
      
      // Mock tool registry with read_many_files tool
      const mockReadManyFilesTool = {
        execute: vi.fn().mockResolvedValue({
          llmContent: 'File content 1\nFile content 2\nFile content 3',
        }),
      };
      
      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getTool: vi.fn().mockReturnValue(mockReadManyFilesTool),
        getFunctionDeclarations: vi.fn().mockReturnValue([]),
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy' }),
      });

      await client.initialize();
      
      // Verify that read_many_files was called for full context
      expect(mockReadManyFilesTool.execute).toHaveBeenCalledWith(
        {
          paths: ['**/*'],
          useDefaultExcludes: true,
        },
        expect.any(AbortSignal)
      );
    });

    it('should handle custom system instructions', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ response: 'Custom response', session_id: 'test' }),
      });

      await client.initialize();
      const chat = client.getChat();

      // The system instruction should be included in the conversation context
      const response = await chat.sendMessage({ message: 'Test message' });
      expect(response.candidates?.[0]?.content?.parts?.[0]?.text).toBe('Custom response');

      // Verify the system instruction was included in the request
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const requestBody = JSON.parse(lastCall[1].body);
      expect(requestBody.message).toContain('User preferences: testing mode');
    });
  });

  describe('Health Check Integration', () => {
    it('should perform successful health check', async () => {
      const mockHealthResponse = {
        status: 'healthy',
        uptime: 12345,
        version: '1.0.0',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthResponse),
      });

      await client.initialize();
      const health = await client.healthCheck();
      
      expect(health).toEqual(mockHealthResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.thinkai.com/api/health',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should handle health check failures', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      await client.initialize();
      await expect(client.healthCheck()).rejects.toThrow('ThinkAI API error: 503 Service Unavailable');
    });
  });
});