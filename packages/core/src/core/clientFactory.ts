/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { GeminiClient } from './client.js';
import { ThinkAIClient } from './thinkAIClient.js';
import { ContentGeneratorConfig } from './contentGenerator.js';

export enum ClientType {
  GEMINI = 'gemini',
  THINKAI = 'thinkai',
}

export interface ClientFactoryConfig {
  type: ClientType;
  config: Config;
  contentGeneratorConfig?: ContentGeneratorConfig;
  thinkAIBaseURL?: string;
}

export interface AIClient {
  initialize(contentGeneratorConfig?: ContentGeneratorConfig): Promise<void>;
  addHistory(content: any): Promise<void>;
  getHistory(): Promise<any[]>;
  setHistory(history: any[]): Promise<void>;
  resetChat(): Promise<void>;
  sendMessageStream(request: any, signal: AbortSignal, turns?: number): AsyncGenerator<any, any>;
  tryCompressChat(force?: boolean): Promise<any>;
  generateContent(contents: any[], config: any, signal: AbortSignal): Promise<any>;
  generateJson(contents: any[], schema: any, signal: AbortSignal, model?: string, config?: any): Promise<any>;
  getChat(): any;
  // Additional properties needed by tools
  readonly model: string;
  readonly embeddingModel: string;
  generateContentConfig?: any;
  readonly MAX_TURNS: number;
  // GeminiClient compatibility methods
  generateEmbedding?(contents: any[], signal: AbortSignal): Promise<any>;
  handleFlashFallback?(error: any): Promise<any>;
}

/**
 * Factory function to create either Gemini or ThinkAI clients
 */
export async function createAIClient(factoryConfig: ClientFactoryConfig): Promise<AIClient> {
  const { type, config, contentGeneratorConfig, thinkAIBaseURL } = factoryConfig;
  
  switch (type) {
    case ClientType.GEMINI:
      const geminiClient = new GeminiClient(config);
      if (contentGeneratorConfig) {
        await geminiClient.initialize(contentGeneratorConfig);
      }
      return geminiClient as any as AIClient;
      
    case ClientType.THINKAI:
      const thinkAIClient = new ThinkAIClient(config, thinkAIBaseURL);
      await thinkAIClient.initialize();
      return thinkAIClient as any as AIClient;
      
    default:
      throw new Error(`Unsupported client type: ${type}`);
  }
}

/**
 * Utility function to detect which client type to use based on configuration
 */
export function detectClientType(config: Config): ClientType {
  // Always use Think AI - no more Gemini
  return ClientType.THINKAI;
}

/**
 * High-level factory function that automatically detects and creates the appropriate client
 */
export async function createAutoDetectedClient(
  config: Config,
  contentGeneratorConfig?: ContentGeneratorConfig
): Promise<AIClient> {
  // Always use Think AI
  const thinkAIBaseURL = process.env.THINKAI_BASE_URL || 'https://thinkai.lat/api';
  
  return createAIClient({
    type: ClientType.THINKAI,
    config,
    contentGeneratorConfig,
    thinkAIBaseURL,
  });
}

/**
 * Configuration helper for setting up ThinkAI environment variables
 */
export function configureThinkAI(baseURL?: string, enable: boolean = true): void {
  if (enable) {
    process.env.USE_THINKAI = 'true';
    if (baseURL) {
      process.env.THINKAI_BASE_URL = baseURL;
    }
  } else {
    delete process.env.USE_THINKAI;
    delete process.env.THINKAI_BASE_URL;
  }
}

/**
 * Health check utility to verify both clients are working
 */
export async function performHealthCheck(config: Config): Promise<{
  gemini: boolean;
  thinkai: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  let geminiHealthy = false;
  let thinkaiHealthy = false;
  
  // Test Gemini client
  try {
    const geminiClient = new GeminiClient(config);
    // Just try to create the client - actual health check would need proper auth
    geminiHealthy = true;
  } catch (error) {
    errors.push(`Gemini client error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Test ThinkAI client
  try {
    const thinkAIClient = new ThinkAIClient(config);
    const health = await thinkAIClient.healthCheck();
    thinkaiHealthy = health ? true : false;
  } catch (error) {
    errors.push(`ThinkAI client error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return {
    gemini: geminiHealthy,
    thinkai: thinkaiHealthy,
    errors,
  };
}