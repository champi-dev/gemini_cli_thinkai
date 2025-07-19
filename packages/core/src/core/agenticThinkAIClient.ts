/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { EditorType } from '../utils/editor.js';
import { ThinkAIClientInterface, ThinkAIMessage, ThinkAIResponse } from './thinkAITypes.js';
// import type { AIClient } from './clientFactory.js'; // Would create circular dependency
import { CoreToolScheduler, ToolCall } from './coreToolScheduler.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { Turn, ServerGeminiStreamEvent, GeminiEventType } from './turn.js';
import { Content, Part, PartListUnion, FunctionCall } from '@google/genai';
import { reportError } from '../utils/errorReporting.js';
import { getErrorMessage } from '../utils/errors.js';

/**
 * Agentic wrapper for ThinkAI client that can execute local tools
 * instead of just sending everything to external API
 */
export class AgenticThinkAIClient implements ThinkAIClientInterface {
  private toolScheduler?: CoreToolScheduler;
  protected agenticConfig: Config;
  private baseClient: ThinkAIClientInterface;
  private baseURL?: string;
  
  constructor(config: Config, baseURL?: string) {
    this.agenticConfig = config;
    this.baseURL = baseURL;
    // Will be initialized in initialize() method using dynamic import
    this.baseClient = {} as ThinkAIClientInterface;
  }

  async initialize() {
    // Create the base ThinkAI client using dynamic import
    const { ThinkAIClient } = await import('./thinkAIClient.js');
    this.baseClient = new ThinkAIClient(this.agenticConfig, this.baseURL);
    await (this.baseClient as any).initialize();
    
    // Initialize tool scheduler if not already done
    if (!this.toolScheduler) {
      const toolRegistry = this.agenticConfig.getToolRegistry();
      if (toolRegistry) {
        this.toolScheduler = new CoreToolScheduler({
          config: this.agenticConfig,
          toolRegistry: toolRegistry,
          getPreferredEditor: () => 'vscode' as EditorType, // Default editor
        });
      }
    }
  }

  /**
   * Analyzes user input to determine if it requires local tool execution
   */
  private requiresLocalTools(message: string): { needsTools: boolean; toolCalls: FunctionCall[] } {
    const lowerMessage = message.toLowerCase();
    
    // Common patterns that indicate tool usage
    const filePatterns = [
      /read\s+(?:file|the file)\s*[`"']?([^`"'\s]+)[`"']?/i,
      /write\s+(?:to\s+)?(?:file|the file)\s*[`"']?([^`"'\s]+)[`"']?/i,
      /edit\s+(?:file|the file)\s*[`"']?([^`"'\s]+)[`"']?/i,
      /create\s+(?:file|a file)\s*[`"']?([^`"'\s]+)?[`"']?/i,
      /list\s+(?:files|directory|dir)/i,
      /delete\s+(?:file|the file)\s*[`"']?([^`"'\s]+)[`"']?/i,
    ];

    const commandPatterns = [
      /run\s+(?:command\s+)?[`"']?([^`"'\n]+)[`"']?/i,
      /execute\s+[`"']?([^`"'\n]+)[`"']?/i,
      /shell\s+[`"']?([^`"'\n]+)[`"']?/i,
      /npm\s+/i,
      /git\s+/i,
      /ls\s/i,
      /pwd/i,
      /mkdir\s/i,
      /cd\s/i,
    ];

    const toolCalls: FunctionCall[] = [];

    // Check for file operations
    for (const pattern of filePatterns) {
      const match = message.match(pattern);
      if (match) {
        if (lowerMessage.includes('read')) {
          toolCalls.push({
            name: 'read_file',
            args: { absolute_path: match[1] || '' }
          });
        } else if (lowerMessage.includes('write') || lowerMessage.includes('create')) {
          toolCalls.push({
            name: 'write_file',
            args: { file_path: match[1] || 'new_file.txt', content: '' }
          });
        } else if (lowerMessage.includes('edit')) {
          toolCalls.push({
            name: 'edit_file',
            args: { file_path: match[1] || '', old_string: '', new_string: '' }
          });
        } else if (lowerMessage.includes('list')) {
          toolCalls.push({
            name: 'list_directory',
            args: { path: '.' }
          });
        }
      }
    }

    // Check for command execution
    for (const pattern of commandPatterns) {
      const match = message.match(pattern);
      if (match) {
        toolCalls.push({
          name: 'run_shell_command',
          args: { command: match[1] || match[0] }
        });
        break; // Only add one shell command per message
      }
    }

    // Check for simple patterns without specific tool calls
    const simplePatterns = [
      /(?:what|list|show).+(?:files|directories)/i,
      /(?:current|working).+directory/i,
      /install\s+/i,
      /build/i,
      /test/i,
    ];

    if (!toolCalls.length) {
      for (const pattern of simplePatterns) {
        if (pattern.test(message)) {
          if (message.toLowerCase().includes('files') || message.toLowerCase().includes('directories')) {
            toolCalls.push({
              name: 'list_directory',
              args: { path: '.' }
            });
          } else if (message.toLowerCase().includes('directory')) {
            toolCalls.push({
              name: 'run_shell_command',
              args: { command: 'pwd' }
            });
          } else if (message.toLowerCase().includes('install')) {
            toolCalls.push({
              name: 'run_shell_command',
              args: { command: message.includes('npm') ? message : `npm install` }
            });
          } else if (message.toLowerCase().includes('build')) {
            toolCalls.push({
              name: 'run_shell_command',
              args: { command: 'npm run build' }
            });
          } else if (message.toLowerCase().includes('test')) {
            toolCalls.push({
              name: 'run_shell_command',
              args: { command: 'npm test' }
            });
          }
          break;
        }
      }
    }

    return { needsTools: toolCalls.length > 0, toolCalls };
  }

  /**
   * Executes local tools based on function calls
   */
  private async executeLocalTools(toolCalls: FunctionCall[]): Promise<string> {
    if (!this.toolScheduler) {
      return 'Tool scheduler not initialized. Cannot execute local tools.';
    }

    const results: string[] = [];
    
    for (const toolCall of toolCalls) {
      const toolName = toolCall.name;
      try {
        const toolRegistry = await this.agenticConfig.getToolRegistry();
        if (!toolRegistry) {
          results.push(`Tool registry not available for ${toolName || 'unknown'}`);
          continue;
        }
        if (!toolName) {
          results.push(`Tool call missing name`);
          continue;
        }
        
        const tool = toolRegistry.getTool(toolName);
        if (!tool) {
          results.push(`Tool '${toolName}' not found`);
          continue;
        }

        // Execute the tool
        const result = await tool.execute(toolCall.args as any, AbortSignal.timeout(30000));
        
        // Convert llmContent to string representation
        let output = '';
        if (result.llmContent) {
          if (typeof result.llmContent === 'string') {
            output = result.llmContent;
          } else if (Array.isArray(result.llmContent)) {
            output = result.llmContent.map(part => {
              if (typeof part === 'string') {
                return part;
              } else if (part && typeof part === 'object' && 'text' in part) {
                return (part as any).text || '';
              }
              return '';
            }).join('');
          } else if (result.llmContent && typeof result.llmContent === 'object' && 'text' in result.llmContent) {
            output = (result.llmContent as any).text || '';
          }
        }
        
        if (output.trim()) {
          results.push(`Tool '${toolName}' executed successfully:\n${output}`);
        } else {
          results.push(`Tool '${toolName}' executed successfully (no output)`);
        }
      } catch (error) {
        results.push(`Error executing tool '${toolName || 'unknown'}': ${getErrorMessage(error)}`);
      }
    }

    return results.join('\n\n');
  }

  /**
   * Enhanced sendMessageStream that can execute local tools
   */
  async *sendMessageStream(
    request: PartListUnion,
    signal: AbortSignal,
    turns: number = this.MAX_TURNS
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    if (!turns) {
      return new Turn(this.getChat() as any);
    }

    // Convert PartListUnion to string message
    let message: string;
    if (typeof request === 'string') {
      message = request;
    } else if (Array.isArray(request)) {
      message = request.map(part => {
        if (typeof part === 'string') {
          return part;
        } else if (part && typeof part === 'object' && 'text' in part) {
          return (part as any).text || '';
        }
        return '';
      }).join(' ');
    } else if (request && typeof request === 'object' && 'text' in request) {
      message = (request as any).text || '';
    } else {
      message = String(request);
    }

    if (!message.trim()) {
      return new Turn(this.getChat() as any);
    }

    try {
      // Add user message to chat history
      this.getChat().addHistory({
        role: 'user',
        parts: [{ text: message }]
      });

      // Check if this requires local tool execution
      const { needsTools, toolCalls } = this.requiresLocalTools(message);
      
      let response = '';
      
      if (needsTools && toolCalls.length > 0) {
        // Execute local tools first
        yield {
          type: GeminiEventType.Content,
          value: `Executing local tools for: ${message}\n\n`
        };

        const toolResults = await this.executeLocalTools(toolCalls);
        response = toolResults;

        // Send the tool results to ThinkAI for interpretation/summary
        const contextMessage = `The user requested: "${message}"\n\nI executed local tools and got these results:\n\n${toolResults}\n\nPlease provide a helpful summary or interpretation of these results.`;
        
        const stream = this.sendMessageStreamToThinkAI(contextMessage, 'code');
        let aiSummary = '';
        
        for await (const chunk of stream) {
          if (signal.aborted) {
            break;
          }
          
          aiSummary += chunk;
          yield {
            type: GeminiEventType.Content,
            value: chunk
          };
        }
        
        response += '\n\n' + aiSummary;
      } else {
        // No local tools needed, send directly to ThinkAI
        const stream = this.sendMessageStreamToThinkAI(message, 'code');
        
        for await (const chunk of stream) {
          if (signal.aborted) {
            break;
          }
          
          response += chunk;
          yield {
            type: GeminiEventType.Content,
            value: chunk
          };
        }
      }

      // Add assistant response to chat history
      if (!signal.aborted && response.trim()) {
        this.getChat().addHistory({
          role: 'model',
          parts: [{ text: response }]
        });
      }

    } catch (error) {
      yield {
        type: GeminiEventType.Error,
        value: {
          error: {
            message: getErrorMessage(error),
            status: 500
          }
        }
      };
    }
    
    return new Turn(this.getChat() as any);
  }

  // Delegate methods to base client
  async sendMessageToThinkAI(message: string, mode: 'general' | 'code' = 'code'): Promise<ThinkAIResponse> {
    return this.baseClient.sendMessageToThinkAI(message, mode);
  }

  async *sendMessageStreamToThinkAI(message: string, mode: 'general' | 'code' = 'code'): AsyncGenerator<string> {
    yield* this.baseClient.sendMessageStreamToThinkAI(message, mode);
  }

  // AIClient interface methods
  async addHistory(content: any): Promise<void> {
    return (this.baseClient as any).addHistory(content);
  }

  async getHistory(): Promise<any[]> {
    return (this.baseClient as any).getHistory();
  }

  async setHistory(history: any[]): Promise<void> {
    return (this.baseClient as any).setHistory(history);
  }

  async resetChat(): Promise<void> {
    return (this.baseClient as any).resetChat();
  }

  async tryCompressChat(force?: boolean): Promise<any> {
    return (this.baseClient as any).tryCompressChat(force);
  }

  async generateContent(contents: any[], config: any, signal: AbortSignal): Promise<any> {
    return (this.baseClient as any).generateContent(contents, config, signal);
  }

  async generateJson(contents: any[], schema: any, signal: AbortSignal, model?: string, config?: any): Promise<any> {
    return (this.baseClient as any).generateJson(contents, schema, signal, model, config);
  }

  getChat(): any {
    return (this.baseClient as any).getChat();
  }

  // Required properties
  get model(): string {
    return (this.baseClient as any).model;
  }

  get embeddingModel(): string {
    return (this.baseClient as any).embeddingModel;
  }

  get generateContentConfig(): any {
    return (this.baseClient as any).generateContentConfig;
  }

  get MAX_TURNS(): number {
    return (this.baseClient as any).MAX_TURNS;
  }
}