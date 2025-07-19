/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Content,
  Part,
  createUserContent,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  SendMessageParameters,
} from '@google/genai';
import { Config } from '../config/config.js';
import { ThinkAIClient, ThinkAIMessage } from './thinkAIClient.js';
import { reportError } from '../utils/errorReporting.js';
import { getErrorMessage } from '../utils/errors.js';
import {
  logApiRequest,
  logApiResponse,
  logApiError,
} from '../telemetry/loggers.js';
import {
  ApiErrorEvent,
  ApiRequestEvent,
  ApiResponseEvent,
} from '../telemetry/types.js';

export interface ThinkAIChatConfig {
  systemInstruction?: string;
  toolDeclarations?: any[];
}

/**
 * Chat session for ThinkAI that maintains conversation history
 * and provides similar interface to GeminiChat
 */
export class ThinkAIChat {
  private sendPromise: Promise<void> = Promise.resolve();
  private sessionId: string;

  constructor(
    private readonly config: Config,
    private readonly client: ThinkAIClient,
    sessionId: string,
    private readonly chatConfig: ThinkAIChatConfig = {},
    private history: Content[] = []
  ) {
    this.sessionId = sessionId;
    this.validateHistory(history);
  }

  private validateHistory(history: Content[]) {
    if (history.length === 0) {
      return;
    }
    for (const content of history) {
      if (content.role !== 'user' && content.role !== 'model') {
        throw new Error(`Role must be user or model, but got ${content.role}.`);
      }
    }
  }

  private extractCuratedHistory(comprehensiveHistory: Content[]): Content[] {
    if (comprehensiveHistory === undefined || comprehensiveHistory.length === 0) {
      return [];
    }
    
    const curatedHistory: Content[] = [];
    const length = comprehensiveHistory.length;
    let i = 0;
    
    while (i < length) {
      if (comprehensiveHistory[i].role === 'user') {
        curatedHistory.push(comprehensiveHistory[i]);
        i++;
      } else {
        const modelOutput: Content[] = [];
        let isValid = true;
        
        while (i < length && comprehensiveHistory[i].role === 'model') {
          modelOutput.push(comprehensiveHistory[i]);
          if (isValid && !this.isValidContent(comprehensiveHistory[i])) {
            isValid = false;
          }
          i++;
        }
        
        if (isValid) {
          curatedHistory.push(...modelOutput);
        } else {
          curatedHistory.pop();
        }
      }
    }
    
    return curatedHistory;
  }

  private isValidContent(content: Content): boolean {
    if (content.parts === undefined || content.parts.length === 0) {
      return false;
    }
    
    for (const part of content.parts) {
      if (part === undefined || Object.keys(part).length === 0) {
        return false;
      }
      if (part.text !== undefined && part.text === '') {
        return false;
      }
    }
    
    return true;
  }

  private getRequestTextFromContents(contents: Content[]): string {
    return contents
      .flatMap((content) => content.parts ?? [])
      .map((part) => part.text)
      .filter(Boolean)
      .join('');
  }

  private async logApiRequest(
    contents: Content[],
    model: string = 'thinkai'
  ): Promise<void> {
    const requestText = this.getRequestTextFromContents(contents);
    logApiRequest(this.config, new ApiRequestEvent(model, requestText));
  }

  private async logApiResponse(
    durationMs: number,
    usageMetadata?: GenerateContentResponseUsageMetadata,
    responseText?: string
  ): Promise<void> {
    logApiResponse(
      this.config,
      new ApiResponseEvent('thinkai', durationMs, usageMetadata, responseText)
    );
  }

  private logApiError(durationMs: number, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.name : 'unknown';

    logApiError(
      this.config,
      new ApiErrorEvent('thinkai', errorMessage, durationMs, errorType)
    );
  }

  private convertHistoryToMessage(): string {
    // Convert conversation history to a single message for ThinkAI
    const systemPrompt = this.chatConfig.systemInstruction || '';
    const conversationHistory = this.getHistory(true)
      .map((content) => {
        const role = content.role === 'user' ? 'Human' : 'Assistant';
        const text = content.parts
          ?.map((part) => part.text)
          .filter(Boolean)
          .join(' ') || '';
        return `${role}: ${text}`;
      })
      .join('\n\n');

    const fullPrompt = [
      systemPrompt,
      conversationHistory,
    ].filter(Boolean).join('\n\n');

    return fullPrompt;
  }

  private convertThinkAIResponseToGemini(
    response: string,
    usageMetadata?: any
  ): any {
    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: response }],
          },
          finishReason: 'STOP' as any,
          index: 0,
        },
      ],
      usageMetadata: usageMetadata ? {
        promptTokenCount: usageMetadata.prompt_tokens,
        candidatesTokenCount: usageMetadata.completion_tokens,
        totalTokenCount: usageMetadata.total_tokens,
      } : undefined,
    };
  }

  /**
   * Sends a message to ThinkAI and returns the response
   */
  async sendMessage(
    params: SendMessageParameters
  ): Promise<GenerateContentResponse> {
    await this.sendPromise;
    const userContent = createUserContent(params.message);
    const requestContents = this.getHistory(true).concat(userContent);

    await this.logApiRequest(requestContents);

    const startTime = Date.now();
    let response: GenerateContentResponse;

    try {
      // Add the new user message to history first
      this.history.push(userContent);
      
      // Convert the conversation to ThinkAI format
      const message = this.convertHistoryToMessage();
      
      // Send to ThinkAI using configured mode
      const thinkAIResponse = await this.client.sendMessageToThinkAI(message, this.config.getThinkAIMode());
      
      // Convert response back to Gemini format
      response = this.convertThinkAIResponseToGemini(
        thinkAIResponse.response,
        thinkAIResponse.usage
      );

      const durationMs = Date.now() - startTime;
      await this.logApiResponse(
        durationMs,
        response.usageMetadata,
        thinkAIResponse.response
      );

      // Update history with the response
      this.sendPromise = (async () => {
        const outputContent = response.candidates?.[0]?.content;
        if (outputContent) {
          this.history.push(outputContent);
        }
      })();

      await this.sendPromise.catch(() => {
        this.sendPromise = Promise.resolve();
      });

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logApiError(durationMs, error);
      this.sendPromise = Promise.resolve();
      
      // Remove the user message from history if there was an error
      if (this.history.length > 0 && this.history[this.history.length - 1].role === 'user') {
        this.history.pop();
      }
      
      throw error;
    }
  }

  /**
   * Sends a message to ThinkAI and returns the response in chunks
   */
  async sendMessageStream(
    params: SendMessageParameters
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    await this.sendPromise;
    const userContent = createUserContent(params.message);
    const requestContents = this.getHistory(true).concat(userContent);
    
    await this.logApiRequest(requestContents);

    const startTime = Date.now();

    try {
      // Add the new user message to history first
      this.history.push(userContent);
      
      // Convert the conversation to ThinkAI format
      const message = this.convertHistoryToMessage();
      
      // Stream from ThinkAI using configured mode
      const stream = this.client.sendMessageStreamToThinkAI(message, this.config.getThinkAIMode());
      
      const result = this.processStreamResponse(stream, userContent, startTime);
      
      // Resolve the internal tracking promise
      this.sendPromise = Promise.resolve()
        .then(() => undefined)
        .catch(() => undefined);

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logApiError(durationMs, error);
      this.sendPromise = Promise.resolve();
      
      // Remove the user message from history if there was an error
      if (this.history.length > 0 && this.history[this.history.length - 1].role === 'user') {
        this.history.pop();
      }
      
      throw error;
    }
  }

  private async *processStreamResponse(
    stream: AsyncGenerator<string>,
    inputContent: Content,
    startTime: number
  ): AsyncGenerator<GenerateContentResponse> {
    let fullResponseText = '';
    let errorOccurred = false;
    const chunks: GenerateContentResponse[] = [];

    try {
      for await (const chunk of stream) {
        fullResponseText += chunk;
        
        // Convert each chunk to Gemini format
        const geminiChunk = this.convertThinkAIResponseToGemini(chunk);
        chunks.push(geminiChunk);
        
        yield geminiChunk;
      }
    } catch (error) {
      errorOccurred = true;
      const durationMs = Date.now() - startTime;
      this.logApiError(durationMs, error);
      throw error;
    }

    if (!errorOccurred) {
      const durationMs = Date.now() - startTime;
      await this.logApiResponse(
        durationMs,
        this.getFinalUsageMetadata(chunks),
        fullResponseText
      );
      
      // Add the complete response to history
      this.recordHistory(inputContent, [{
        role: 'model',
        parts: [{ text: fullResponseText }],
      }]);
    }
  }

  private getFinalUsageMetadata(
    chunks: GenerateContentResponse[]
  ): GenerateContentResponseUsageMetadata | undefined {
    const lastChunkWithMetadata = chunks
      .slice()
      .reverse()
      .find((chunk) => chunk.usageMetadata);

    return lastChunkWithMetadata?.usageMetadata;
  }

  private recordHistory(
    userInput: Content,
    modelOutput: Content[]
  ) {
    const validModelOutput = modelOutput.filter(
      (content) => this.isValidContent(content)
    );

    if (validModelOutput.length > 0) {
      this.history.push(...validModelOutput);
    }
  }

  /**
   * Returns the chat history
   */
  getHistory(curated: boolean = false): Content[] {
    const history = curated
      ? this.extractCuratedHistory(this.history)
      : this.history;
    
    return structuredClone(history);
  }

  /**
   * Clears the chat history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Adds a new entry to the chat history
   */
  addHistory(content: Content): void {
    this.history.push(content);
  }

  /**
   * Sets the chat history
   */
  setHistory(history: Content[]): void {
    this.validateHistory(history);
    this.history = history;
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the chat configuration
   */
  getChatConfig(): ThinkAIChatConfig {
    return this.chatConfig;
  }
}