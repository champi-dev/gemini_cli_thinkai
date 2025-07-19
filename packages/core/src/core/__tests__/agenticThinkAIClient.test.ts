import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgenticThinkAIClient } from '../agenticThinkAIClient.js';
import { Config } from '../../config/config.js';
import { ToolRegistry } from '../../tools/tool-registry.js';

// Mock dependencies
vi.mock('../../config/config.js');
vi.mock('../../tools/tool-registry.js');

describe('AgenticThinkAIClient', () => {
  let client: AgenticThinkAIClient;
  let mockConfig: any;
  let mockToolRegistry: any;
  let mockBaseClient: any;
  
  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock config
    mockConfig = {
      getWorkingDir: vi.fn().mockReturnValue('/test/dir'),
      getToolRegistry: vi.fn(),
      getFileService: vi.fn(),
      getFullContext: vi.fn().mockReturnValue(false),
      getDebugMode: vi.fn().mockReturnValue(false),
      getUserMemory: vi.fn().mockReturnValue('')
    };
    
    // Mock tool registry
    mockToolRegistry = {
      getTool: vi.fn(),
      getFunctionDeclarations: vi.fn().mockReturnValue([])
    };
    
    mockConfig.getToolRegistry.mockResolvedValue(mockToolRegistry);
    
    // Mock base client for AI responses
    mockBaseClient = {
      sendMessageToThinkAI: vi.fn(),
      sendMessageStreamToThinkAI: vi.fn(),
      getChat: vi.fn().mockReturnValue({
        getHistory: vi.fn().mockReturnValue([])
      }),
      initialize: vi.fn().mockResolvedValue(undefined)
    };
    
    // Mock the dynamic import of ThinkAIClient
    vi.doMock('../thinkAIClient.js', () => ({
      ThinkAIClient: vi.fn().mockImplementation(() => mockBaseClient)
    }));
    
    // Create client instance and initialize it
    client = new AgenticThinkAIClient(mockConfig);
    await client.initialize();
  });
  
  describe('parseUserIntent', () => {
    it('should parse write server intent correctly', async () => {
      // Mock AI response for Go server creation
      mockBaseClient.sendMessageToThinkAI.mockResolvedValue({
        response: JSON.stringify({
          needsTools: true,
          toolCalls: [{
            name: 'write_file',
            args: {
              file_path: '/test/dir/server.go',
              content: 'package main\n\nfunc main() {}'
            }
          }]
        })
      });
      
      const result = await (client as any).parseUserIntent('write a simple golang server');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('write_file');
      expect(result.toolCalls[0].args.file_path).toBe('/test/dir/server.go');
    });
    
    it('should parse compound action (write and execute)', async () => {
      mockBaseClient.sendMessageToThinkAI.mockResolvedValue({
        response: JSON.stringify({
          needsTools: true,
          toolCalls: [
            {
              name: 'write_file',
              args: {
                file_path: '/test/dir/server.py',
                content: 'from flask import Flask\napp = Flask(__name__)'
              }
            },
            {
              name: 'run_shell_command',
              args: {
                command: 'python3 server.py'
              }
            }
          ]
        })
      });
      
      const result = await (client as any).parseUserIntent('write a python flask server and run it');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('write_file');
      expect(result.toolCalls[1].name).toBe('run_shell_command');
    });
    
    it('should handle questions without tools', async () => {
      mockBaseClient.sendMessageToThinkAI.mockResolvedValue({
        response: JSON.stringify({
          needsTools: false,
          toolCalls: []
        })
      });
      
      const result = await (client as any).parseUserIntent('how can I test it locally?');
      
      expect(result.needsTools).toBe(false);
      expect(result.toolCalls).toHaveLength(0);
    });
    
    it('should use fallback when AI parsing fails', async () => {
      // Mock AI to throw error, triggering fallback
      mockBaseClient.sendMessageToThinkAI.mockRejectedValue(new Error('API error'));
      
      const result = await (client as any).parseUserIntent('write a simple golang server for hello world');
      
      // Fallback should still detect Go server creation
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('write_file');
      expect(result.toolCalls[0].args.file_path).toContain('server.go');
      expect(result.toolCalls[0].args.content).toContain('package main');
    });
  });
  
  describe('fallbackPatternMatching', () => {
    it('should detect golang server creation', () => {
      const result = (client as any).fallbackPatternMatching('write a golang hello world server');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('write_file');
      expect(result.toolCalls[0].args.file_path).toContain('server.go');
      expect(result.toolCalls[0].args.content).toContain('package main');
      expect(result.toolCalls[0].args.content).toContain('Hello World');
    });
    
    it('should detect compound actions', () => {
      const result = (client as any).fallbackPatternMatching('write a python server and execute it');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('write_file');
      expect(result.toolCalls[0].args.file_path).toContain('.py');
      expect(result.toolCalls[1].name).toBe('run_shell_command');
      expect(result.toolCalls[1].args.command).toContain('python');
    });
    
    it('should detect node.js as default', () => {
      const result = (client as any).fallbackPatternMatching('write a server');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls[0].args.file_path).toContain('server.js');
      expect(result.toolCalls[0].args.content).toContain('const http = require');
    });
    
    it('should handle "run it" commands', () => {
      // Mock chat history to have previous file creation
      mockBaseClient.getChat.mockReturnValue({
        getHistory: vi.fn().mockReturnValue([
          { role: 'user', parts: [{ text: 'write a golang server' }] },
          { role: 'assistant', parts: [{ text: 'Created server.go' }] }
        ])
      });
      
      const result = (client as any).fallbackPatternMatching('run it');
      
      expect(result.needsTools).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('run_shell_command');
      expect(result.toolCalls[0].args.command).toContain('go run');
    });
  });
  
  describe('selectMode', () => {
    it('should select general mode for questions', async () => {
      mockBaseClient.sendMessageToThinkAI.mockResolvedValue({
        response: 'general'
      });
      
      const mode = await (client as any).selectMode('how can I test it locally?');
      
      expect(mode).toBe('general');
    });
    
    it('should default to general on error', async () => {
      mockBaseClient.sendMessageToThinkAI.mockRejectedValue(new Error('API error'));
      
      const mode = await (client as any).selectMode('any message');
      
      expect(mode).toBe('general');
    });
  });
});