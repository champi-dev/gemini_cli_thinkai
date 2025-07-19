/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createAIClient,
  createAutoDetectedClient,
  detectClientType,
  configureThinkAI,
  performHealthCheck,
  ClientType,
} from './clientFactory.js';
import { GeminiClient } from './client.js';
import { ThinkAIClient } from './thinkAIClient.js';
import { Config } from '../config/config.js';

// Mock the client classes
vi.mock('./client.js');
vi.mock('./thinkAIClient.js');

describe('clientFactory', () => {
  let mockConfig: Config;
  
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Clear environment variables
    delete process.env.THINKAI_BASE_URL;
    delete process.env.USE_THINKAI;
    
    // Setup config mock
    mockConfig = {
      getWorkingDir: vi.fn().mockReturnValue('/test/dir'),
      getFileService: vi.fn().mockReturnValue({}),
      getToolRegistry: vi.fn().mockReturnValue({
        getTool: vi.fn().mockReturnValue(null),
        getFunctionDeclarations: vi.fn().mockReturnValue([]),
      }),
      getFullContext: vi.fn().mockReturnValue(false),
      getUserMemory: vi.fn().mockReturnValue(''),
      getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
      getModel: vi.fn().mockReturnValue('thinkai-model'),
      getEmbeddingModel: vi.fn().mockReturnValue('thinkai-embedding'),
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        authType: 'test',
      }),
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

  describe('createAIClient', () => {
    it('should create Gemini client when type is GEMINI', async () => {
      const mockGeminiClient = {
        initialize: vi.fn(),
      };
      vi.mocked(GeminiClient).mockImplementation(() => mockGeminiClient as any);
      
      const contentGeneratorConfig = { authType: 'test' as any, model: 'test-model' };
      const client = await createAIClient({
        type: ClientType.GEMINI,
        config: mockConfig,
        contentGeneratorConfig,
      });
      
      expect(GeminiClient).toHaveBeenCalledWith(mockConfig);
      expect(mockGeminiClient.initialize).toHaveBeenCalledWith(contentGeneratorConfig);
      expect(client).toBe(mockGeminiClient);
    });

    it('should create Gemini client without contentGeneratorConfig', async () => {
      const mockGeminiClient = {
        initialize: vi.fn(),
      };
      vi.mocked(GeminiClient).mockImplementation(() => mockGeminiClient as any);
      
      const client = await createAIClient({
        type: ClientType.GEMINI,
        config: mockConfig,
      });
      
      expect(GeminiClient).toHaveBeenCalledWith(mockConfig);
      expect(mockGeminiClient.initialize).not.toHaveBeenCalled();
      expect(client).toBe(mockGeminiClient);
    });

    it('should create ThinkAI client when type is THINKAI', async () => {
      const mockThinkAIClient = {
        initialize: vi.fn(),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const client = await createAIClient({
        type: ClientType.THINKAI,
        config: mockConfig,
        thinkAIBaseURL: 'https://custom.thinkai.com',
      });
      
      expect(ThinkAIClient).toHaveBeenCalledWith(mockConfig, 'https://custom.thinkai.com');
      expect(mockThinkAIClient.initialize).toHaveBeenCalled();
      expect(client).toBe(mockThinkAIClient);
    });

    it('should create ThinkAI client with default URL when not specified', async () => {
      const mockThinkAIClient = {
        initialize: vi.fn(),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const client = await createAIClient({
        type: ClientType.THINKAI,
        config: mockConfig,
      });
      
      expect(ThinkAIClient).toHaveBeenCalledWith(mockConfig, undefined);
      expect(mockThinkAIClient.initialize).toHaveBeenCalled();
      expect(client).toBe(mockThinkAIClient);
    });

    it('should throw error for unsupported client type', async () => {
      await expect(createAIClient({
        type: 'unsupported' as any,
        config: mockConfig,
      })).rejects.toThrow('Unsupported client type: unsupported');
    });
  });

  describe('detectClientType', () => {
    it('should return THINKAI by default (exclusively Think AI)', () => {
      const clientType = detectClientType(mockConfig);
      expect(clientType).toBe(ClientType.THINKAI);
    });

    it('should return THINKAI when USE_THINKAI is true', () => {
      process.env.USE_THINKAI = 'true';
      
      const clientType = detectClientType(mockConfig);
      expect(clientType).toBe(ClientType.THINKAI);
    });

    it('should return THINKAI when THINKAI_BASE_URL is set', () => {
      process.env.THINKAI_BASE_URL = 'https://custom.thinkai.com';
      
      const clientType = detectClientType(mockConfig);
      expect(clientType).toBe(ClientType.THINKAI);
    });

    it('should return THINKAI when both env vars are set', () => {
      process.env.USE_THINKAI = 'true';
      process.env.THINKAI_BASE_URL = 'https://custom.thinkai.com';
      
      const clientType = detectClientType(mockConfig);
      expect(clientType).toBe(ClientType.THINKAI);
    });

    it('should return THINKAI when USE_THINKAI is false (exclusively Think AI)', () => {
      process.env.USE_THINKAI = 'false';
      
      const clientType = detectClientType(mockConfig);
      expect(clientType).toBe(ClientType.THINKAI);
    });

    it('should return THINKAI when USE_THINKAI is empty string (exclusively Think AI)', () => {
      process.env.USE_THINKAI = '';
      
      const clientType = detectClientType(mockConfig);
      expect(clientType).toBe(ClientType.THINKAI);
    });
  });

  describe('createAutoDetectedClient', () => {
    it('should create ThinkAI client when auto-detected (exclusively Think AI)', async () => {
      const mockThinkAIClient = {
        initialize: vi.fn(),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const contentGeneratorConfig = { authType: 'test' as any, model: 'test-model' };
      const client = await createAutoDetectedClient(mockConfig, contentGeneratorConfig);
      
      expect(ThinkAIClient).toHaveBeenCalledWith(mockConfig, 'https://thinkai.lat/api');
      expect(mockThinkAIClient.initialize).toHaveBeenCalled();
      expect(client).toBe(mockThinkAIClient);
    });

    it('should create ThinkAI client when auto-detected as THINKAI', async () => {
      process.env.USE_THINKAI = 'true';
      process.env.THINKAI_BASE_URL = 'https://custom.thinkai.com';
      
      const mockThinkAIClient = {
        initialize: vi.fn(),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const client = await createAutoDetectedClient(mockConfig);
      
      expect(ThinkAIClient).toHaveBeenCalledWith(mockConfig, 'https://custom.thinkai.com');
      expect(mockThinkAIClient.initialize).toHaveBeenCalled();
      expect(client).toBe(mockThinkAIClient);
    });

    it('should use default ThinkAI URL when not specified in env', async () => {
      process.env.USE_THINKAI = 'true';
      
      const mockThinkAIClient = {
        initialize: vi.fn(),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const client = await createAutoDetectedClient(mockConfig);
      
      expect(ThinkAIClient).toHaveBeenCalledWith(mockConfig, 'https://thinkai.lat/api');
      expect(mockThinkAIClient.initialize).toHaveBeenCalled();
      expect(client).toBe(mockThinkAIClient);
    });

    it('should work without contentGeneratorConfig (exclusively Think AI)', async () => {
      const mockThinkAIClient = {
        initialize: vi.fn(),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const client = await createAutoDetectedClient(mockConfig);
      
      expect(ThinkAIClient).toHaveBeenCalledWith(mockConfig, 'https://thinkai.lat/api');
      expect(mockThinkAIClient.initialize).toHaveBeenCalled();
      expect(client).toBe(mockThinkAIClient);
    });
  });

  describe('configureThinkAI', () => {
    it('should enable ThinkAI with default settings', () => {
      configureThinkAI();
      
      expect(process.env.USE_THINKAI).toBe('true');
      expect(process.env.THINKAI_BASE_URL).toBeUndefined();
    });

    it('should enable ThinkAI with custom base URL', () => {
      configureThinkAI('https://custom.thinkai.com');
      
      expect(process.env.USE_THINKAI).toBe('true');
      expect(process.env.THINKAI_BASE_URL).toBe('https://custom.thinkai.com');
    });

    it('should enable ThinkAI explicitly', () => {
      configureThinkAI('https://custom.thinkai.com', true);
      
      expect(process.env.USE_THINKAI).toBe('true');
      expect(process.env.THINKAI_BASE_URL).toBe('https://custom.thinkai.com');
    });

    it('should disable ThinkAI and clear env vars', () => {
      // First enable it
      process.env.USE_THINKAI = 'true';
      process.env.THINKAI_BASE_URL = 'https://custom.thinkai.com';
      
      configureThinkAI(undefined, false);
      
      expect(process.env.USE_THINKAI).toBeUndefined();
      expect(process.env.THINKAI_BASE_URL).toBeUndefined();
    });

    it('should not set base URL when disabling', () => {
      // First enable it
      process.env.USE_THINKAI = 'true';
      process.env.THINKAI_BASE_URL = 'https://custom.thinkai.com';
      
      configureThinkAI('https://should-not-be-set.com', false);
      
      expect(process.env.USE_THINKAI).toBeUndefined();
      expect(process.env.THINKAI_BASE_URL).toBeUndefined();
    });
  });

  describe('performHealthCheck', () => {
    it('should return healthy status for Think AI client only', async () => {
      // Mock successful ThinkAI client creation and health check
      const mockThinkAIClient = {
        healthCheck: vi.fn().mockResolvedValue({ status: 'healthy' }),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const result = await performHealthCheck(mockConfig);
      
      expect(result).toEqual({
        gemini: false, // We don't use Gemini anymore
        thinkai: true,
        errors: [],
      });
      
      expect(ThinkAIClient).toHaveBeenCalledWith(mockConfig);
      expect(mockThinkAIClient.healthCheck).toHaveBeenCalled();
    });

    it('should handle successful Think AI client (no Gemini check)', async () => {
      // Mock successful ThinkAI client
      const mockThinkAIClient = {
        healthCheck: vi.fn().mockResolvedValue({ status: 'healthy' }),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const result = await performHealthCheck(mockConfig);
      
      expect(result).toEqual({
        gemini: false, // We don't check Gemini anymore
        thinkai: true,
        errors: [],
      });
    });

    it('should handle ThinkAI client creation error', async () => {
      // Mock failed ThinkAI client creation
      const thinkAIError = new Error('ThinkAI initialization failed');
      vi.mocked(ThinkAIClient).mockImplementation(() => {
        throw thinkAIError;
      });
      
      const result = await performHealthCheck(mockConfig);
      
      expect(result).toEqual({
        gemini: false, // We don't use Gemini anymore
        thinkai: false,
        errors: ['ThinkAI client error: ThinkAI initialization failed'],
      });
    });

    it('should handle ThinkAI health check failure', async () => {
      // Mock ThinkAI client with failed health check
      const mockThinkAIClient = {
        healthCheck: vi.fn().mockResolvedValue(null),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const result = await performHealthCheck(mockConfig);
      
      expect(result).toEqual({
        gemini: false, // We don't use Gemini anymore
        thinkai: false,
        errors: [],
      });
    });

    it('should handle ThinkAI health check error', async () => {
      // Mock ThinkAI client with health check error
      const healthCheckError = new Error('Health check failed');
      const mockThinkAIClient = {
        healthCheck: vi.fn().mockRejectedValue(healthCheckError),
      };
      vi.mocked(ThinkAIClient).mockImplementation(() => mockThinkAIClient as any);
      
      const result = await performHealthCheck(mockConfig);
      
      expect(result).toEqual({
        gemini: false, // We don't use Gemini anymore
        thinkai: false,
        errors: ['ThinkAI client error: Health check failed'],
      });
    });

    it('should handle Think AI client failing', async () => {
      // Mock failed ThinkAI client creation
      const thinkAIError = new Error('ThinkAI failed');
      vi.mocked(ThinkAIClient).mockImplementation(() => {
        throw thinkAIError;
      });
      
      const result = await performHealthCheck(mockConfig);
      
      expect(result).toEqual({
        gemini: false, // We don't check Gemini anymore
        thinkai: false,
        errors: [
          'ThinkAI client error: ThinkAI failed',
        ],
      });
    });

    it('should handle non-Error objects', async () => {
      // Mock failed ThinkAI client creation with non-Error
      vi.mocked(ThinkAIClient).mockImplementation(() => {
        throw { message: 'Object error' };
      });
      
      const result = await performHealthCheck(mockConfig);
      
      expect(result).toEqual({
        gemini: false,
        thinkai: false,
        errors: [
          'ThinkAI client error: [object Object]',
        ],
      });
    });
  });

  describe('ClientType enum', () => {
    it('should have correct enum values', () => {
      expect(ClientType.GEMINI).toBe('gemini');
      expect(ClientType.THINKAI).toBe('thinkai');
    });
  });
});