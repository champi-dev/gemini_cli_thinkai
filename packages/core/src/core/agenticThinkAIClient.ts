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
   * Uses ThinkAI to intelligently parse user intent and determine tool calls
   */
  private async parseUserIntent(message: string): Promise<{ needsTools: boolean; toolCalls: FunctionCall[] }> {
    // Get comprehensive conversation context for eternal memory
    const history = await this.getChat().getHistory();
    const conversationContext = history.slice(-8).map((entry: any) => 
      `${entry.role}: ${entry.parts?.map((p: any) => p.text).join(' ') || ''}`
    ).join('\n');

    const intentPrompt = `ANALYZE this message for COMPOUND ACTIONS with full conversation context. Break down what the user wants and execute ALL required tools.

CONVERSATION CONTEXT:
${conversationContext}

CURRENT MESSAGE: "${message}"
WORKING DIR: ${this.agenticConfig.getWorkingDir()}

DETECTION RULES:
1. ANY mention of "write/create/make + server/file" = CREATE FILE with working code
2. ANY mention of "run/execute/start" = EXECUTE appropriate command  
3. COMPOUND requests like "write X and run it" = BOTH create file AND execute
4. Questions only = NO TOOLS

EXAMPLES:
"write server.js and run it" → {"needsTools": true, "toolCalls": [{"name": "write_file", "args": {"file_path": "/full/path/server.js", "content": "const http = require('http');const server = http.createServer((req, res) => {res.writeHead(200, {'Content-Type': 'text/html'});res.end('<h1>Hello World!</h1>');});const PORT = 3000;server.listen(PORT, () => console.log(\`Server running at http://localhost:\${PORT}\`));"}}, {"name": "run_shell_command", "args": {"command": "node server.js"}}]}

"write hello world server" → {"needsTools": true, "toolCalls": [{"name": "write_file", "args": {"file_path": "/full/path/server.js", "content": "ACTUAL WORKING CODE HERE"}}]}

"how does this work" → {"needsTools": false, "toolCalls": []}

CRITICAL: For file creation, generate COMPLETE working code. For compound actions, return MULTIPLE tool calls.

RESPOND WITH VALID JSON ONLY:`;

    try {
      const response = await this.baseClient.sendMessageToThinkAI(intentPrompt, 'code');
      const cleanResponse = response.response.trim().replace(/^```json\s*|\s*```$/g, '');
      const parsed = JSON.parse(cleanResponse);
      
      return {
        needsTools: parsed.needsTools || false,
        toolCalls: parsed.toolCalls || []
      };
    } catch (error) {
      // Fallback: Use simple pattern matching for critical operations
      return this.fallbackPatternMatching(message);
    }
  }

  /**
   * Smart mode selection using ThinkAI
   */
  private async selectMode(message: string): Promise<'general' | 'code'> {
    // Get conversation context for better mode selection
    const history = await this.getChat().getHistory();
    const recentHistory = history.slice(-3).map((entry: any) => 
      `${entry.role}: ${entry.parts?.map((p: any) => p.text).join(' ') || ''}`
    ).join('\n');

    const modePrompt = `Based on the context and message, determine the optimal response mode:

RECENT CONTEXT:
${recentHistory}

CURRENT MESSAGE: "${message}"

MODE RULES:
- GENERAL: Questions, explanations, troubleshooting, "how can I", "what is", "why", conceptual discussions
- CODE: File operations already handled by tools, so use general for explanations

Since file operations are handled separately by tools, use GENERAL mode for conversational responses.

RESPOND WITH ONLY: general`;

    try {
      const response = await this.baseClient.sendMessageToThinkAI(modePrompt, 'general');
      const mode = response.response.trim().toLowerCase();
      return mode === 'code' ? 'code' : 'general';
    } catch (error) {
      return 'general'; // Safe default
    }
  }

  /**
   * Fallback pattern matching for when AI parsing fails
   */
  private fallbackPatternMatching(message: string): { needsTools: boolean; toolCalls: FunctionCall[] } {
    const lowerMessage = message.toLowerCase().trim();
    const workingDir = this.agenticConfig.getWorkingDir();
    const toolCalls: FunctionCall[] = [];

    // Robust fallback patterns for critical operations
    const needsFileCreation = lowerMessage.includes('write') && 
      (lowerMessage.includes('server') || lowerMessage.includes('node') || lowerMessage.includes('hello'));
    
    const needsExecution = lowerMessage.includes('run') || lowerMessage.includes('execute') || 
      lowerMessage.includes('start') || (lowerMessage.includes('and') && lowerMessage.includes('it'));

    if (needsFileCreation) {
      // Generate a working Node.js server
      const serverContent = `const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end('<h1>Hello World!</h1><p>Server is running successfully!</p>');
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(\`Server running at http://localhost:\${PORT}\`);
});`;

      toolCalls.push({
        name: 'write_file',
        args: { file_path: `${workingDir}/server.js`, content: serverContent }
      });
    }

    if (needsExecution) {
      toolCalls.push({
        name: 'run_shell_command',
        args: { command: 'node server.js' }
      });
    }

    if (lowerMessage.includes('list') && lowerMessage.includes('files')) {
      toolCalls.push({
        name: 'list_directory',
        args: { path: '.' }
      });
    }

    return { needsTools: toolCalls.length > 0, toolCalls };
  }

  /**
   * Analyzes user input to determine if it requires local tool execution
   */
  private async requiresLocalTools(message: string): Promise<{ needsTools: boolean; toolCalls: FunctionCall[] }> {
    return await this.parseUserIntent(message);
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

      // Check if this requires local tool execution FIRST
      const { needsTools, toolCalls } = await this.requiresLocalTools(message);
      
      let response = '';
      
      if (needsTools && toolCalls.length > 0) {
        // Execute local tools with detailed progress reporting
        yield {
          type: GeminiEventType.Content,
          value: `✦ Executing ${toolCalls.length} tool(s) for: ${message}\n\n`
        };

        const toolResults = await this.executeLocalTools(toolCalls);
        
        // Generate intelligent response based on what was accomplished
        const fileOperations = toolCalls.filter(tc => tc.name === 'write_file');
        const commandOperations = toolCalls.filter(tc => tc.name === 'run_shell_command');
        
        let helpfulResponse = '';
        
        if (fileOperations.length > 0 && commandOperations.length > 0) {
          // Compound operation: file creation + execution
          const fileName = fileOperations[0].args?.file_path || 'file';
          const command = commandOperations[0].args?.command || 'command';
          helpfulResponse = `✅ Created '${fileName}' and executed '${command}'\n\n${toolResults}`;
        } else if (fileOperations.length > 0) {
          // File creation only
          const fileName = fileOperations[0].args?.file_path || 'file';
          helpfulResponse = `✅ Created file '${fileName}'\n\n${toolResults}`;
        } else if (commandOperations.length > 0) {
          // Command execution only
          const command = commandOperations[0].args?.command || 'command';
          helpfulResponse = `✅ Executed '${command}'\n\n${toolResults}`;
        } else {
          helpfulResponse = `✅ Completed operation\n\n${toolResults}`;
        }
        
        response = helpfulResponse;
        
        // Yield the complete response
        yield {
          type: GeminiEventType.Content,
          value: helpfulResponse
        };
      } else {
        // No local tools needed, send to ThinkAI with smart mode selection
        const mode = await this.selectMode(message);
        try {
          const stream = this.sendMessageStreamToThinkAI(message, mode);
          
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
        } catch (streamError) {
          // If streaming fails, provide a helpful local response
          const fallbackResponse = `I understand you want to "${message}". However, I'm currently running in local mode and this request doesn't match any local tools I can execute. Available local tools include file operations (read, write, edit), shell commands, and directory listings.`;
          
          response = fallbackResponse;
          yield {
            type: GeminiEventType.Content,
            value: fallbackResponse
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