/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { getCoreSystemPrompt } from './prompts.js';
import { ThinkAIChat } from './thinkAIChat.js';
import { reportError } from '../utils/errorReporting.js';
import { getErrorMessage } from '../utils/errors.js';
import { retryWithBackoff } from '../utils/retry.js';
import {
  Turn,
  ServerGeminiStreamEvent,
  GeminiEventType,
  ChatCompressionInfo,
} from './turn.js';
import { Content, Part, PartListUnion } from '@google/genai';
import { getFolderStructure } from '../utils/getFolderStructure.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';

export interface ThinkAIMessage {
  message: string;
  session_id?: string;
  mode?: 'general' | 'code';
  use_web_search?: boolean;
  fact_check?: boolean;
}

export interface ThinkAIResponse {
  response: string;
  session_id: string;
  mode: string;
  timestamp: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ThinkAIStreamResponse {
  data: string;
  session_id: string;
  finished: boolean;
}

export class ThinkAIClient {
  private chat?: ThinkAIChat;
  private readonly baseURL: string;
  private readonly sessionId: string;
  readonly MAX_TURNS = 100;
  readonly model = 'thinkai';
  readonly embeddingModel = 'thinkai-embedding';
  readonly generateContentConfig = {};

  constructor(
    private config: Config,
    baseURL: string = 'https://thinkai.lat/api'
  ) {
    this.baseURL = baseURL;
    this.sessionId = this.generateSessionId();
  }

  async initialize() {
    this.chat = await this.startChat();
  }

  private generateSessionId(): string {
    return `gemini-cli-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`ThinkAI API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private async makeStreamRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`ThinkAI API error: ${response.status} ${response.statusText}`);
    }

    return response.body!;
  }

  getChat(): ThinkAIChat {
    if (!this.chat) {
      throw new Error('Chat not initialized');
    }
    return this.chat;
  }

  async addHistory(content: Content) {
    this.getChat().addHistory(content);
  }

  async getHistory(): Promise<Content[]> {
    return this.getChat().getHistory();
  }

  async setHistory(history: Content[]): Promise<void> {
    this.getChat().setHistory(history);
  }

  async resetChat(): Promise<void> {
    this.chat = await this.startChat();
  }

  private async getEnvironment(): Promise<Part[]> {
    const cwd = this.config.getWorkingDir();
    const today = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const platform = process.platform;
    const folderStructure = await getFolderStructure(cwd, {
      fileService: this.config.getFileService(),
    });
    const context = `
Okay, just setting up the context for our chat.
Today is ${today}.
My operating system is: ${platform}
I'm currently working in the directory: ${cwd}
${folderStructure}
        `.trim();

    const initialParts: Part[] = [{ text: context }];
    const toolRegistry = await this.config.getToolRegistry();

    if (this.config.getFullContext()) {
      try {
        const readManyFilesTool = toolRegistry.getTool(
          'read_many_files'
        ) as ReadManyFilesTool;
        if (readManyFilesTool) {
          const result = await readManyFilesTool.execute(
            {
              paths: ['**/*'],
              useDefaultExcludes: true,
            },
            AbortSignal.timeout(30000)
          );
          if (result.llmContent) {
            initialParts.push({
              text: `\n--- Full File Context ---\n${result.llmContent}`,
            });
          } else {
            console.warn(
              'Full context requested, but read_many_files returned no content.'
            );
          }
        } else {
          console.warn(
            'Full context requested, but read_many_files tool not found.'
          );
        }
      } catch (error) {
        console.error('Error reading full file context:', error);
        initialParts.push({
          text: '\n--- Error reading full file context ---',
        });
      }
    }

    return initialParts;
  }

  private async startChat(extraHistory?: Content[]): Promise<ThinkAIChat> {
    const envParts = await this.getEnvironment();
    const toolRegistry = await this.config.getToolRegistry();
    const toolDeclarations = toolRegistry ? toolRegistry.getFunctionDeclarations() : [];
    
    const initialHistory: Content[] = [
      {
        role: 'user',
        parts: envParts,
      },
      {
        role: 'model',
        parts: [{ text: 'Got it. Thanks for the context!' }],
      },
    ];
    const history = initialHistory.concat(extraHistory ?? []);
    
    try {
      const userMemory = this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(userMemory);
      
      return new ThinkAIChat(
        this.config,
        this,
        this.sessionId,
        {
          systemInstruction,
          toolDeclarations,
        },
        history
      );
    } catch (error) {
      await reportError(
        error,
        'Error initializing ThinkAI chat session.',
        history,
        'startChat'
      );
      throw new Error(`Failed to initialize chat: ${getErrorMessage(error)}`);
    }
  }

  async sendMessage(request: ThinkAIMessage): Promise<ThinkAIResponse> {
    const apiCall = () =>
      this.makeRequest<ThinkAIResponse>('/chat', {
        method: 'POST',
        body: JSON.stringify(request),
      });

    return await retryWithBackoff(apiCall);
  }

  async *sendMessageStream(
    request: PartListUnion,
    signal: AbortSignal,
    turns: number = this.MAX_TURNS
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    if (!turns) {
      return new Turn(this.getChat() as any);
    }

    // Convert PartListUnion to string message for ThinkAI
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

      // Stream from ThinkAI API
      const stream = this.sendMessageStreamToThinkAI(message, 'code');
      let fullResponse = '';

      for await (const chunk of stream) {
        if (signal.aborted) {
          break;
        }
        
        fullResponse += chunk;
        
        // Yield content events in the expected format
        yield {
          type: GeminiEventType.Content,
          value: chunk
        };
      }

      // Add assistant response to chat history
      if (!signal.aborted && fullResponse.trim()) {
        this.getChat().addHistory({
          role: 'model',
          parts: [{ text: fullResponse }]
        });
      }

    } catch (error) {
      // Yield error event in the expected format
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

  async sendMessageToThinkAI(message: string, mode: 'general' | 'code' = 'code'): Promise<ThinkAIResponse> {
    const request: ThinkAIMessage = {
      message,
      session_id: this.sessionId,
      mode,
      use_web_search: false,
      fact_check: false,
    };

    try {
      return await this.sendMessage(request);
    } catch (error) {
      await reportError(
        error,
        'Error sending message to ThinkAI.',
        { message, mode },
        'sendMessageToThinkAI'
      );
      throw new Error(`Failed to send message: ${getErrorMessage(error)}`);
    }
  }

  async *sendMessageStreamToThinkAI(
    message: string,
    mode: 'general' | 'code' = 'code'
  ): AsyncGenerator<string> {
    const request: ThinkAIMessage = {
      message,
      session_id: this.sessionId,
      mode,
      use_web_search: false,
      fact_check: false,
    };

    try {
      // Try streaming first, but fall back to regular API if it fails
      try {
        const stream = await this.makeStreamRequest('/chat/stream', {
          method: 'POST',
          body: JSON.stringify(request),
        });

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]' || data === '') {
                continue;
              }
              
              try {
                const parsed = JSON.parse(data);
                if (parsed.chunk) {
                  yield parsed.chunk;
                }
                
                if (parsed.done) {
                  return;
                }
              } catch (error) {
                console.warn('Failed to parse stream data:', data);
              }
            }
          }
        }
      } catch (streamError) {
        // Fallback to regular chat API if streaming fails
        console.warn('Streaming failed, falling back to regular API');
        const response = await this.sendMessageToThinkAI(message, mode);
        yield response.response;
        return;
      }
    } catch (error) {
      await reportError(
        error,
        'Error streaming message to ThinkAI.',
        { message, mode },
        'sendMessageStreamToThinkAI'
      );
      throw new Error(`Failed to stream message: ${getErrorMessage(error)}`);
    }
  }

  async tryCompressChat(
    force: boolean = false
  ): Promise<ChatCompressionInfo | null> {
    // For now, return null as ThinkAI handles session management
    return null;
  }

  async generateContent(
    contents: any[],
    config: any,
    signal: AbortSignal
  ): Promise<any> {
    // Convert contents to a simple message for ThinkAI
    const message = contents
      .map(content => content.parts?.map((part: any) => part.text).join(' '))
      .join(' ');
    
    const response = await this.sendMessageToThinkAI(message, 'code');
    return {
      candidates: [{
        content: {
          role: 'model',
          parts: [{ text: response.response }]
        }
      }]
    };
  }

  async generateJson(
    contents: any[],
    schema: any,
    signal: AbortSignal,
    model?: string,
    config?: any
  ): Promise<any> {
    // Convert contents to a simple message for ThinkAI
    const message = contents
      .map(content => content.parts?.map((part: any) => part.text).join(' '))
      .join(' ');
    
    const response = await this.sendMessageToThinkAI(
      `${message}\n\nPlease respond with valid JSON that matches the required schema.`,
      'code'
    );
    
    try {
      return JSON.parse(response.response);
    } catch (error) {
      // If parsing fails, return a default object
      return { result: response.response };
    }
  }

  async getSessions(): Promise<any[]> {
    try {
      return await this.makeRequest<any[]>('/chat/sessions');
    } catch (error) {
      await reportError(
        error,
        'Error getting ThinkAI sessions.',
        {},
        'getSessions'
      );
      throw new Error(`Failed to get sessions: ${getErrorMessage(error)}`);
    }
  }

  async getSession(sessionId: string): Promise<any> {
    try {
      return await this.makeRequest<any>(`/chat/sessions/${sessionId}`);
    } catch (error) {
      await reportError(
        error,
        'Error getting ThinkAI session.',
        { sessionId },
        'getSession'
      );
      throw new Error(`Failed to get session: ${getErrorMessage(error)}`);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.makeRequest<void>(`/chat/sessions/${sessionId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      await reportError(
        error,
        'Error deleting ThinkAI session.',
        { sessionId },
        'deleteSession'
      );
      throw new Error(`Failed to delete session: ${getErrorMessage(error)}`);
    }
  }

  async searchKnowledge(query: string): Promise<any> {
    try {
      return await this.makeRequest<any>(`/knowledge/search?q=${encodeURIComponent(query)}`);
    } catch (error) {
      await reportError(
        error,
        'Error searching ThinkAI knowledge.',
        { query },
        'searchKnowledge'
      );
      throw new Error(`Failed to search knowledge: ${getErrorMessage(error)}`);
    }
  }

  async getKnowledgeDomains(): Promise<any[]> {
    try {
      return await this.makeRequest<any[]>('/knowledge/domains');
    } catch (error) {
      await reportError(
        error,
        'Error getting ThinkAI knowledge domains.',
        {},
        'getKnowledgeDomains'
      );
      throw new Error(`Failed to get knowledge domains: ${getErrorMessage(error)}`);
    }
  }

  async getKnowledgeStats(): Promise<any> {
    try {
      return await this.makeRequest<any>('/knowledge/stats');
    } catch (error) {
      await reportError(
        error,
        'Error getting ThinkAI knowledge stats.',
        {},
        'getKnowledgeStats'
      );
      throw new Error(`Failed to get knowledge stats: ${getErrorMessage(error)}`);
    }
  }

  async healthCheck(): Promise<any> {
    try {
      return await this.makeRequest<any>('/health');
    } catch (error) {
      await reportError(
        error,
        'Error checking ThinkAI health.',
        {},
        'healthCheck'
      );
      throw new Error(`Failed to check health: ${getErrorMessage(error)}`);
    }
  }
}