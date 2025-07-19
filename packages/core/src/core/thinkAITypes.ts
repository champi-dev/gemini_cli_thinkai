/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

/**
 * Interface for ThinkAI client methods needed by ThinkAIChat
 */
export interface ThinkAIClientInterface {
  sendMessageToThinkAI(message: string, mode?: 'general' | 'code'): Promise<ThinkAIResponse>;
  sendMessageStreamToThinkAI(message: string, mode?: 'general' | 'code'): AsyncGenerator<string>;
}