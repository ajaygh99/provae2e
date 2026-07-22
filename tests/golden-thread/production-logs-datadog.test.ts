import { DatadogConnector } from '../../src/core/production-logs-datadog.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DatadogConnector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('queryByDeploymentSha', () => {
    it('should successfully fetch logs by deployment SHA', async () => {
      const mockResponse = {
        data: {
          logs: [
            {
              attributes: {
                status: 'ERROR',
                message: 'Database connection failed',
                timestamp: '2026-01-01T10:00:00.000Z',
                tags: ['service:api', 'env:production'],
                deployment_sha: 'abc123'
              }
            }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });
      const logs = await connector.queryByDeploymentSha('abc123', 'api-service', 'production');

      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('ERROR');
      expect(logs[0].message).toBe('Database connection failed');
      expect(logs[0].deployment_sha).toBe('abc123');
    });

    it('should parse log level correctly', async () => {
      const mockResponse = {
        data: {
          logs: [
            { attributes: { status: 'ERROR', message: 'Error', timestamp: '2026-01-01T10:00:00.000Z', tags: [], deployment_sha: 'a1' } },
            { attributes: { status: 'WARNING', message: 'Warn', timestamp: '2026-01-01T10:00:00.000Z', tags: [], deployment_sha: 'a1' } },
            { attributes: { status: 'INFO', message: 'Info', timestamp: '2026-01-01T10:00:00.000Z', tags: [], deployment_sha: 'a1' } },
            { attributes: { status: 'DEBUG', message: 'Debug', timestamp: '2026-01-01T10:00:00.000Z', tags: [], deployment_sha: 'a1' } }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });
      const logs = await connector.queryByDeploymentSha('a1', 'service', 'prod');

      expect(logs[0].level).toBe('ERROR');
      expect(logs[1].level).toBe('WARNING');
      expect(logs[2].level).toBe('INFO');
      expect(logs[3].level).toBe('DEBUG');
    });

    it('should extract tags correctly', async () => {
      const mockResponse = {
        data: {
          logs: [
            {
              attributes: {
                status: 'ERROR',
                message: 'Error',
                timestamp: '2026-01-01T10:00:00.000Z',
                tags: ['service:api', 'env:production', 'region:us-east-1'],
                deployment_sha: 'a1'
              }
            }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });
      const logs = await connector.queryByDeploymentSha('a1', 'api', 'prod');

      expect(logs[0].tags).toEqual({
        service: 'api',
        env: 'production',
        region: 'us-east-1'
      });
    });

    it('should use correct query format', async () => {
      const mockGet = jest.fn().mockResolvedValue({ data: { logs: [] } });
      mockedAxios.create.mockReturnValue({
        get: mockGet
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });
      await connector.queryByDeploymentSha('abc123', 'payment-service', 'staging');

      expect(mockGet).toHaveBeenCalledWith('/api/v2/logs-queries/list', expect.objectContaining({
        params: expect.objectContaining({
          query: 'service:payment-service env:staging deployed_commit_sha:abc123'
        })
      }));
    });
  });

  describe('queryLogs', () => {
    it('should execute custom query', async () => {
      const mockResponse = {
        data: {
          logs: [
            {
              attributes: {
                status: 'ERROR',
                message: 'Custom query error',
                timestamp: '2026-01-01T10:00:00.000Z',
                tags: [],
                deployment_sha: 'custom'
              }
            }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });
      const logs = await connector.queryLogs('service:api status:error');

      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Custom query error');
    });

    it('should handle empty response', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: { logs: [] } })
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });
      const logs = await connector.queryLogs('nonexistent:query');

      expect(logs).toHaveLength(0);
    });

    it('should handle API error', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('API Error'))
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });

      await expect(connector.queryLogs('query')).rejects.toThrow('Failed to query Datadog logs');
    });
  });

  describe('Initialization', () => {
    it('should use custom base URL if provided', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new DatadogConnector({
        apiKey: 'test-key',
        baseUrl: 'https://custom.datadog.com'
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom.datadog.com'
        })
      );
    });

    it('should include app key in headers if provided', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new DatadogConnector({
        apiKey: 'test-key',
        appKey: 'test-app-key'
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'DD-API-KEY': 'test-key',
            'DD-APPLICATION-KEY': 'test-app-key'
          })
        })
      );
    });
  });

  describe('Log level parsing', () => {
    it('should map CRITICAL to ERROR', async () => {
      const mockResponse = {
        data: {
          logs: [
            {
              attributes: {
                status: 'CRITICAL',
                message: 'Critical',
                timestamp: '2026-01-01T10:00:00.000Z',
                tags: [],
                deployment_sha: 'a1'
              }
            }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });
      const logs = await connector.queryLogs('query');

      expect(logs[0].level).toBe('ERROR');
    });

    it('should map ALERT to WARNING', async () => {
      const mockResponse = {
        data: {
          logs: [
            {
              attributes: {
                status: 'ALERT',
                message: 'Alert',
                timestamp: '2026-01-01T10:00:00.000Z',
                tags: [],
                deployment_sha: 'a1'
              }
            }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });
      const logs = await connector.queryLogs('query');

      expect(logs[0].level).toBe('WARNING');
    });

    it('should default to INFO for unknown level', async () => {
      const mockResponse = {
        data: {
          logs: [
            {
              attributes: {
                status: 'TRACE',
                message: 'Trace',
                timestamp: '2026-01-01T10:00:00.000Z',
                tags: [],
                deployment_sha: 'a1'
              }
            }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new DatadogConnector({ apiKey: 'test-key' });
      const logs = await connector.queryLogs('query');

      expect(logs[0].level).toBe('INFO');
    });
  });
});
