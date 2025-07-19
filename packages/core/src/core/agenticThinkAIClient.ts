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
    // Get conversation context
    const history = await this.getChat().getHistory();
    const conversationContext = history.slice(-5).map((entry: any) => 
      `${entry.role}: ${entry.parts?.map((p: any) => p.text).join(' ') || ''}`
    ).join('\n');

    const intentPrompt = `You are a CLI tool parser. Based on the message and context, determine if local tools are needed and generate appropriate tool calls.

CONTEXT:
${conversationContext}

MESSAGE: "${message}"
WORKING_DIR: ${this.agenticConfig.getWorkingDir()}

TOOLS AVAILABLE:
- write_file: Create files (args: file_path, content)
- run_shell_command: Execute commands (args: command)
- list_directory: List files (args: path)

RULES:
1. "write/create X server" → Generate complete working code using write_file
2. "run/execute it" → Use context to determine what to run
3. Questions → No tools needed

For file creation, generate complete, working code based on the request. For Python servers, use http.server. For Node.js, use http module.

Return JSON: {"needsTools": boolean, "toolCalls": [{"name": "tool", "args": {...}}]}`;

    try {
      console.log('🤖 Sending to ThinkAI with prompt...');
      const response = await this.baseClient.sendMessageToThinkAI(intentPrompt, 'code');
      console.log('📥 Raw AI response:', response.response);
      
      // Clean and parse response
      let cleanResponse = response.response.trim();
      
      // Remove markdown code blocks if present
      cleanResponse = cleanResponse.replace(/^```(?:json)?\s*|\s*```$/gm, '');
      
      // Try to extract JSON if it's embedded in text
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[0];
      }
      
      console.log('🧹 Cleaned response:', cleanResponse);
      
      const parsed = JSON.parse(cleanResponse);
      console.log('✅ Parsed result:', JSON.stringify(parsed, null, 2));
      
      return {
        needsTools: parsed.needsTools || false,
        toolCalls: parsed.toolCalls || []
      };
    } catch (error) {
      // Only fall back to patterns if AI completely fails
      console.error('❌ AI parsing failed:', error);
      console.log('🔄 Using fallback pattern matching...');
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
    // Better fallback that detects language and action
    const lowerMessage = message.toLowerCase().trim();
    const workingDir = this.agenticConfig.getWorkingDir();
    const toolCalls: FunctionCall[] = [];

    console.log('🔍 Fallback analyzing:', lowerMessage);

    // Detect file creation
    const writePattern = lowerMessage.includes('write') || lowerMessage.includes('create');
    const serverPattern = lowerMessage.includes('server') || lowerMessage.includes('hello');
    
    if (writePattern && serverPattern) {
      // Detect language
      let fileName = 'server.js';
      let content = 'console.log("Hello World");';
      let runCommand = 'node server.js';
      
      if (lowerMessage.includes('golang') || lowerMessage.includes('go ')) {
        fileName = 'server.go';
        content = `package main\n\nimport (\n    "fmt"\n    "net/http"\n)\n\nfunc main() {\n    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {\n        fmt.Fprintf(w, "Hello World!")\n    })\n    fmt.Println("Server running at http://localhost:8080")\n    http.ListenAndServe(":8080", nil)\n}`;
        runCommand = 'go run server.go';
      } else if (lowerMessage.includes('python')) {
        fileName = 'server.py';
        content = 'print("Hello World")';
        runCommand = 'python3 server.py';
      }
      
      console.log(`📝 Creating ${fileName} with fallback content`);
      
      toolCalls.push({
        name: 'write_file',
        args: { 
          file_path: `${workingDir}/${fileName}`, 
          content: content
        }
      });
      
      // Check for compound action
      if (lowerMessage.includes('and') && (lowerMessage.includes('execute') || lowerMessage.includes('run'))) {
        console.log(`🏃 Adding execution: ${runCommand}`);
        toolCalls.push({
          name: 'run_shell_command',
          args: { command: runCommand }
        });
      }
    }

    // Basic execution detection
    else if (lowerMessage.match(/^(run|execute|start)(\s+it)?$/i)) {
      console.log('🏃 Execute only pattern detected');
      toolCalls.push({
        name: 'run_shell_command',
        args: { command: 'node server.js' }
      });
    }

    console.log('🔄 Fallback result:', { needsTools: toolCalls.length > 0, toolCalls });
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