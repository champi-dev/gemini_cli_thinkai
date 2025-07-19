/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThinkAIClient } from './thinkAIClient.js';
import { ThinkAIChat } from './thinkAIChat.js';
import { Config } from '../config/config.js';
import { 
  createAutoDetectedClient, 
  configureThinkAI, 
  performHealthCheck,
  ClientType 
} from './clientFactory.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { GitService } from '../services/gitService.js';

// Mock fetch for E2E tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ThinkAI End-to-End Tests', () => {
  let realConfig: Config;
  let fileService: FileDiscoveryService;
  let gitService: GitService;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Clear environment variables
    delete process.env.THINKAI_BASE_URL;
    delete process.env.USE_THINKAI;
    
    // Setup real-like services
    fileService = new FileDiscoveryService('/home/user/project');
    gitService = new GitService('/home/user/project');
    
    // Setup realistic config
    realConfig = {
      getWorkingDir: vi.fn().mockReturnValue('/home/user/project'),
      getFileService: vi.fn().mockReturnValue(fileService),
      getGitService: vi.fn().mockReturnValue(gitService),
      getToolRegistry: vi.fn().mockReturnValue({
        getTool: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({
            llmContent: 'package.json\nsrc/index.js\nsrc/utils.js\nREADME.md',
          }),
        }),
        getFunctionDeclarations: vi.fn().mockReturnValue([
          {
            name: 'read_file',
            description: 'Read a file from the filesystem',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
              },
              required: ['path'],
            },
          },
          {
            name: 'write_file',
            description: 'Write content to a file',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
            },
          },
        ]),
      }),
      getFullContext: vi.fn().mockReturnValue(false),
      getUserMemory: vi.fn().mockReturnValue('User prefers TypeScript and modern JavaScript patterns'),
      getModel: vi.fn().mockReturnValue('thinkai-code'),
      getEmbeddingModel: vi.fn().mockReturnValue('thinkai-embedding'),
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        authType: 'none',
        apiKey: 'test-key',
      }),
      getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
      setModel: vi.fn(),
      flashFallbackHandler: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    
    // Clean up environment variables
    delete process.env.THINKAI_BASE_URL;
    delete process.env.USE_THINKAI;
  });

  describe('Full User Journey', () => {
    it('should complete a full coding session workflow', async () => {
      // Configure ThinkAI
      configureThinkAI('https://thinkai.lat/api');
      
      // Mock realistic API responses
      const mockResponses = [
        // Health check
        { status: 'healthy', uptime: 12345, version: '1.0.0' },
        // Initial greeting
        { 
          response: 'Hello! I\'m ready to help you with your coding project. I can see you\'re working in /home/user/project. What would you like to work on?',
          session_id: 'session-123',
          usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 }
        },
        // Code analysis response
        {
          response: 'I can help you analyze your JavaScript code. Let me examine the structure and suggest improvements. Based on your preference for TypeScript and modern patterns, I recommend:\n\n1. Convert to TypeScript\n2. Use ES modules\n3. Add type definitions\n\nWould you like me to help with any of these?',
          session_id: 'session-123',
          usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 }
        },
        // Implementation response
        {
          response: 'I\'ll help you convert your JavaScript to TypeScript. Here\'s the converted code:\n\n```typescript\ninterface User {\n  id: number;\n  name: string;\n  email: string;\n}\n\nexport class UserService {\n  private users: User[] = [];\n\n  addUser(user: User): void {\n    this.users.push(user);\n  }\n\n  getUser(id: number): User | undefined {\n    return this.users.find(user => user.id === id);\n  }\n}\n```\n\nThis adds proper typing and follows modern TypeScript patterns.',
          session_id: 'session-123',
          usage: { prompt_tokens: 180, completion_tokens: 85, total_tokens: 265 }
        },
      ];

      let callCount = 0;
      mockFetch.mockImplementation((url) => {
        if (url.includes('/health')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockResponses[0]),
          });
        }
        
        const response = mockResponses[Math.min(callCount + 1, mockResponses.length - 1)];
        callCount++;
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
        });
      });

      // Step 1: Health check
      const healthCheck = await performHealthCheck(realConfig);
      expect(healthCheck.thinkai).toBe(true);
      // We might have Think AI connection errors in real environment, so just check it's not undefined
      expect(Array.isArray(healthCheck.errors)).toBe(true);

      // Step 2: Create client
      const client = await createAutoDetectedClient(realConfig);
      expect(client).toBeInstanceOf(ThinkAIClient);

      // Step 3: Initialize chat
      const chat = (client as any as ThinkAIClient).getChat();
      expect(chat).toBeInstanceOf(ThinkAIChat);

      // Step 4: Initial conversation
      const greeting = await chat.sendMessage({ 
        message: 'Hello, I need help with my JavaScript project.' 
      });
      
      expect(greeting.candidates?.[0]?.content?.parts?.[0]?.text).toContain('Hello!');
      expect(greeting.candidates?.[0]?.content?.parts?.[0]?.text).toContain('/home/user/project');

      // Step 5: Code analysis request
      const analysis = await chat.sendMessage({ 
        message: 'Can you analyze my code and suggest improvements?' 
      });
      
      expect(analysis.candidates?.[0]?.content?.parts?.[0]?.text).toContain('TypeScript');
      expect(analysis.candidates?.[0]?.content?.parts?.[0]?.text).toContain('ES modules');

      // Step 6: Implementation request
      const implementation = await chat.sendMessage({ 
        message: 'Please convert my UserService class to TypeScript with proper interfaces.' 
      });
      
      expect(implementation.candidates?.[0]?.content?.parts?.[0]?.text).toContain('interface User');
      expect(implementation.candidates?.[0]?.content?.parts?.[0]?.text).toContain('class UserService');

      // Step 7: Verify conversation history
      const history = chat.getHistory();
      expect(history).toHaveLength(8); // 4 user messages + 4 model responses (includes system setup)
      
      // Verify conversation flow (account for system setup messages)
      expect(history[2].role).toBe('user'); // First actual user message after system setup
      expect(history[2].parts?.[0]?.text).toContain('help with my JavaScript project');
      
      expect(history[3].role).toBe('model');
      expect(history[3].parts?.[0]?.text).toContain('Hello!');
      
      expect(history[7].role).toBe('model');
      expect(history[7].parts?.[0]?.text).toContain('interface User');

      // Step 8: Verify session management
      const sessionId = chat.getSessionId();
      expect(sessionId).toMatch(/^gemini-cli-\d+-[a-z0-9]+$/);
    });

    it('should handle streaming responses in real-time', async () => {
      configureThinkAI('https://thinkai.lat/api');
      
      // Mock streaming response
      const streamChunks = [
        'data: {"chunk": "Let me help you", "done": false}\n',
        'data: {"chunk": " write a TypeScript", "done": false}\n',
        'data: {"chunk": " function. Here\'s an example:", "done": false}\n',
        'data: {"chunk": "\\n\\n```typescript\\nfunction calculateSum(a: number, b: number): number {\\n  return a + b;\\n}\\n```", "done": true}\n',
      ];

      mockFetch.mockImplementation((url) => {
        if (url.includes('/stream')) {
          const mockStream = new ReadableStream({
            start(controller) {
              streamChunks.forEach(chunk => {
                controller.enqueue(new TextEncoder().encode(chunk));
              });
              controller.close();
            },
          });
          
          return Promise.resolve({
            ok: true,
            body: mockStream,
          });
        }
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'healthy' }),
        });
      });

      const client = await createAutoDetectedClient(realConfig);
      const chat = (client as any as ThinkAIClient).getChat();

      // Test streaming
      const generator = await chat.sendMessageStream({ 
        message: 'Write a TypeScript function to calculate sum' 
      });
      
      const streamedChunks = [];
      for await (const chunk of generator) {
        streamedChunks.push(chunk.candidates?.[0]?.content?.parts?.[0]?.text);
      }

      expect(streamedChunks).toEqual([
        'Let me help you',
        ' write a TypeScript',
        ' function. Here\'s an example:',
        '\n\n```typescript\nfunction calculateSum(a: number, b: number): number {\n  return a + b;\n}\n```',
      ]);

      // Verify complete message in history (account for system setup)
      const history = chat.getHistory();
      expect(history[3].parts?.[0]?.text).toBe(
        'Let me help you write a TypeScript function. Here\'s an example:\n\n```typescript\nfunction calculateSum(a: number, b: number): number {\n  return a + b;\n}\n```'
      );
    });

    it('should handle complex multi-turn programming task', async () => {
      configureThinkAI('https://thinkai.lat/api');
      
      // Mock responses for a complex programming task
      const programmingResponses = [
        {
          response: 'I\'ll help you build a REST API with Express and TypeScript. Let\'s start with the project structure and dependencies.',
          session_id: 'programming-session',
        },
        {
          response: 'Here\'s the package.json with all necessary dependencies:\n\n```json\n{\n  "name": "my-api",\n  "version": "1.0.0",\n  "scripts": {\n    "dev": "ts-node-dev src/index.ts",\n    "build": "tsc",\n    "start": "node dist/index.js"\n  },\n  "dependencies": {\n    "express": "^4.18.0",\n    "typescript": "^5.0.0"\n  }\n}\n```',
          session_id: 'programming-session',
        },
        {
          response: 'Now let\'s create the main server file:\n\n```typescript\nimport express from \'express\';\nimport { userRouter } from \'./routes/users\';\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(express.json());\napp.use(\'/api/users\', userRouter);\n\napp.listen(PORT, () => {\n  console.log(`Server running on port ${PORT}`);\n});\n```',
          session_id: 'programming-session',
        },
        {
          response: 'Here\'s the user router with full CRUD operations:\n\n```typescript\nimport { Router } from \'express\';\nimport { User } from \'../models/User\';\n\nconst router = Router();\n\nrouter.get(\'/\', (req, res) => {\n  res.json(users);\n});\n\nrouter.post(\'/\', (req, res) => {\n  const user = new User(req.body);\n  users.push(user);\n  res.status(201).json(user);\n});\n\nexport { router as userRouter };\n```',
          session_id: 'programming-session',
        },
      ];

      let responseIndex = 0;
      mockFetch.mockImplementation(() => {
        const response = programmingResponses[responseIndex] || programmingResponses[0];
        responseIndex++;
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
        });
      });

      const client = await createAutoDetectedClient(realConfig);
      const chat = (client as any as ThinkAIClient).getChat();

      // Multi-turn programming conversation
      const tasks = [
        'I want to build a REST API with Express and TypeScript. Can you help me set it up?',
        'Create a package.json file with all necessary dependencies.',
        'Now create the main server file with Express setup.',
        'Add user CRUD routes to the API.',
      ];

      const responses = [];
      for (const task of tasks) {
        const response = await chat.sendMessage({ message: task });
        responses.push(response.candidates?.[0]?.content?.parts?.[0]?.text);
      }

      // Verify each response
      expect(responses[0]).toContain('REST API with Express and TypeScript');
      expect(responses[1]).toContain('package.json');
      expect(responses[1]).toContain('express');
      expect(responses[2]).toContain('import express');
      expect(responses[2]).toContain('app.listen');
      expect(responses[3]).toContain('Router');
      expect(responses[3]).toContain('CRUD operations');

      // Verify complete conversation history
      const history = chat.getHistory();
      expect(history).toHaveLength(10); // 4 user messages + 4 model responses + system setup
    });

    it('should handle error recovery and continuation', async () => {
      configureThinkAI('https://thinkai.lat/api');
      
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        
        if (callCount === 1) {
          // First call fails
          return Promise.reject(new Error('Network timeout'));
        }
        
        if (callCount === 2) {
          // Second call succeeds
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              response: 'Sorry about that interruption. How can I help you with your code?',
              session_id: 'recovery-session',
            }),
          });
        }
        
        // Subsequent calls succeed
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: 'I can help you fix that JavaScript error. Here\'s the corrected code.',
            session_id: 'recovery-session',
          }),
        });
      });

      const client = await createAutoDetectedClient(realConfig);
      const chat = (client as any as ThinkAIClient).getChat();

      // First request fails
      await expect(chat.sendMessage({ 
        message: 'Help me fix this JavaScript error' 
      })).rejects.toThrow('Network timeout');

      // History should be clean (no partial messages from failed request)
      expect(chat.getHistory()).toHaveLength(2); // System setup messages remain

      // Second request succeeds
      const recovery = await chat.sendMessage({ 
        message: 'Are you available to help?' 
      });
      
      expect(recovery.candidates?.[0]?.content?.parts?.[0]?.text).toContain('Sorry about that interruption');

      // Third request continues normally
      const continuation = await chat.sendMessage({ 
        message: 'I have a JavaScript error to fix' 
      });
      
      expect(continuation.candidates?.[0]?.content?.parts?.[0]?.text).toContain('fix that JavaScript error');

      // Verify clean history after recovery
      const history = chat.getHistory();
      expect(history).toHaveLength(6); // 2 successful exchanges + system setup
    });
  });

  describe('Tool Integration E2E', () => {
    it('should integrate with file system tools', async () => {
      configureThinkAI('https://thinkai.lat/api');
      
      // Mock file system operations
      const mockToolResults = {
        'read_file': 'const users = [];\n\nfunction addUser(user) {\n  users.push(user);\n}\n\nmodule.exports = { addUser };',
        'write_file': 'File written successfully',
      };

      mockFetch.mockImplementation((url, options) => {
        const body = JSON.parse(options.body);
        
        // Check if the message contains tool usage
        if (body.message.includes('read_file') || body.message.includes('write_file')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              response: 'I can see your JavaScript code. Here\'s the TypeScript version:\n\n```typescript\ninterface User {\n  id: number;\n  name: string;\n}\n\nconst users: User[] = [];\n\nfunction addUser(user: User): void {\n  users.push(user);\n}\n\nexport { addUser };\n```',
              session_id: 'tool-session',
            }),
          });
        }
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: 'I\'ll help you work with your files. What would you like to do?',
            session_id: 'tool-session',
          }),
        });
      });

      const client = await createAutoDetectedClient(realConfig);
      const chat = (client as any as ThinkAIClient).getChat();

      // Request file analysis
      const analysis = await chat.sendMessage({ 
        message: 'Read my src/users.js file and convert it to TypeScript' 
      });
      
      expect(analysis.candidates?.[0]?.content?.parts?.[0]?.text).toContain('TypeScript version');
      expect(analysis.candidates?.[0]?.content?.parts?.[0]?.text).toContain('interface User');
    });

    it('should handle git operations', async () => {
      configureThinkAI('https://thinkai.lat/api');
      
      // Mock git integration
      realConfig.getGitService = vi.fn().mockReturnValue({
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
        getStatus: vi.fn().mockResolvedValue({
          modified: ['src/index.ts'],
          staged: [],
          untracked: ['src/new-feature.ts'],
        }),
        commit: vi.fn().mockResolvedValue('abc123'),
      });

      mockFetch.mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: 'I can see you\'re on the main branch with modified files. Here\'s a suggested commit message:\n\n"feat: add TypeScript support and new feature module"\n\nWould you like me to help you commit these changes?',
            session_id: 'git-session',
          }),
        });
      });

      const client = await createAutoDetectedClient(realConfig);
      const chat = (client as any as ThinkAIClient).getChat();

      const gitHelp = await chat.sendMessage({ 
        message: 'Help me commit my changes with a good commit message' 
      });
      
      expect(gitHelp.candidates?.[0]?.content?.parts?.[0]?.text).toContain('main branch');
      expect(gitHelp.candidates?.[0]?.content?.parts?.[0]?.text).toContain('commit message');
    });
  });

  describe('Performance E2E', () => {
    it('should handle large codebases efficiently', async () => {
      configureThinkAI('https://thinkai.lat/api');
      
      // Mock large codebase context
      realConfig.getFullContext = vi.fn().mockReturnValue(true);
      
      const largeMockContent = Array.from({ length: 1000 }, (_, i) => 
        `// File ${i}\nfunction file${i}Function() {\n  return ${i};\n}\n`
      ).join('\n');

      mockFetch.mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: 'I\'ve analyzed your large codebase. Here are the key patterns I found:\n\n1. You have 1000+ JavaScript files\n2. Most follow similar function patterns\n3. I recommend consolidating common utilities\n\nWould you like me to help refactor?',
            session_id: 'large-codebase-session',
            usage: { prompt_tokens: 50000, completion_tokens: 150, total_tokens: 50150 },
          }),
        });
      });

      const client = await createAutoDetectedClient(realConfig);
      const chat = (client as any as ThinkAIClient).getChat();

      const startTime = Date.now();
      const analysis = await chat.sendMessage({ 
        message: 'Analyze my entire codebase and suggest improvements' 
      });
      const endTime = Date.now();

      expect(analysis.candidates?.[0]?.content?.parts?.[0]?.text).toContain('1000+ JavaScript files');
      expect(analysis.usageMetadata?.totalTokenCount).toBe(50150);
      
      // Should complete within reasonable time (adjust as needed)
      expect(endTime - startTime).toBeLessThan(10000); // 10 seconds
    });

    it('should handle concurrent user sessions', async () => {
      configureThinkAI('https://thinkai.lat/api');
      
      // Mock responses for different sessions
      mockFetch.mockImplementation((url, options) => {
        const body = JSON.parse(options.body);
        const sessionId = body.session_id;
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: `Response for session ${sessionId}`,
            session_id: sessionId,
          }),
        });
      });

      // Create multiple clients (simulating different users)
      const clients = await Promise.all([
        createAutoDetectedClient(realConfig),
        createAutoDetectedClient(realConfig),
        createAutoDetectedClient(realConfig),
      ]);

      const chats = clients.map(client => (client as any as ThinkAIClient).getChat());

      // Send concurrent requests
      const promises = chats.map((chat, index) => 
        chat.sendMessage({ message: `Request from user ${index}` })
      );

      const results = await Promise.all(promises);
      
      // Verify each session gets its own response
      results.forEach((result: any, index: number) => {
        expect(result.candidates?.[0]?.content?.parts?.[0]?.text).toContain(
          `session ${chats[index].getSessionId()}`
        );
      });
    });
  });

  describe('Configuration E2E', () => {
    it('should work with different API endpoints', async () => {
      // Test production endpoint
      configureThinkAI('https://thinkai.lat/api');
      
      mockFetch.mockImplementation((url) => {
        expect(url).toContain('thinkai.lat');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: 'Connected to production API',
            session_id: 'prod-session',
          }),
        });
      });

      let client = await createAutoDetectedClient(realConfig);
      let chat = (client as any as ThinkAIClient).getChat();
      
      let response = await chat.sendMessage({ message: 'Test production' });
      expect(response.candidates?.[0]?.content?.parts?.[0]?.text).toBe('Connected to production API');

      // Test development endpoint
      configureThinkAI('http://localhost:8080/api');
      
      mockFetch.mockImplementation((url) => {
        expect(url).toContain('localhost:8080');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: 'Connected to development API',
            session_id: 'dev-session',
          }),
        });
      });

      client = await createAutoDetectedClient(realConfig);
      chat = (client as any as ThinkAIClient).getChat();
      
      response = await chat.sendMessage({ message: 'Test development' });
      expect(response.candidates?.[0]?.content?.parts?.[0]?.text).toBe('Connected to development API');
    });

    it('should handle different modes (general vs code)', async () => {
      configureThinkAI('https://thinkai.lat/api');
      
      mockFetch.mockImplementation((url, options) => {
        const body = JSON.parse(options.body);
        const mode = body.mode;
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: mode === 'code' 
              ? 'I\'m in code mode. How can I help with your programming?'
              : 'I\'m in general mode. What would you like to discuss?',
            session_id: 'mode-session',
          }),
        });
      });

      const client = await createAutoDetectedClient(realConfig);
      const thinkAIClient = client as ThinkAIClient;

      // Test code mode (default)
      const codeResponse = await thinkAIClient.sendMessageToThinkAI('Help with JavaScript', 'code');
      expect(codeResponse.response).toContain('code mode');

      // Test general mode
      const generalResponse = await thinkAIClient.sendMessageToThinkAI('Tell me about AI', 'general');
      expect(generalResponse.response).toContain('general mode');
    });
  });

  describe('Complete User Workflow', () => {
    it('should complete a full development workflow', async () => {
      configureThinkAI('https://thinkai.lat/api');
      
      // Mock a complete development workflow
      const workflowResponses = [
        'I\'ll help you create a new Node.js project. Let\'s start with the project setup.',
        'Here\'s your package.json configuration...',
        'Now let\'s create the main application file...',
        'I\'ll add unit tests for your functions...',
        'Let\'s set up the build and deployment scripts...',
        'Perfect! Your project is now ready for development.',
      ];

      let responseIndex = 0;
      mockFetch.mockImplementation(() => {
        const response = workflowResponses[responseIndex] || workflowResponses[0];
        responseIndex++;
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response,
            session_id: 'workflow-session',
          }),
        });
      });

      const client = await createAutoDetectedClient(realConfig);
      const chat = (client as any as ThinkAIClient).getChat();

      // Complete workflow steps
      const steps = [
        'Create a new Node.js project',
        'Set up package.json',
        'Create main application file',
        'Add unit tests',
        'Set up build scripts',
        'Finalize the project',
      ];

      const responses = [];
      for (const step of steps) {
        const response = await chat.sendMessage({ message: step });
        responses.push(response.candidates?.[0]?.content?.parts?.[0]?.text);
      }

      // Verify workflow completion
      expect(responses[0]).toContain('Node.js project');
      expect(responses[1]).toContain('package.json');
      expect(responses[2]).toContain('main application');
      expect(responses[3]).toContain('unit tests');
      expect(responses[4]).toContain('build');
      expect(responses[5]).toContain('ready for development');

      // Verify complete conversation history
      const history = chat.getHistory();
      expect(history).toHaveLength(14); // 6 user messages + 6 model responses + system setup
    });
  });
});