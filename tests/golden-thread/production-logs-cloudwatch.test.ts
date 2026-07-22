import { CloudWatchConnector } from '../../src/core/production-logs-cloudwatch.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CloudWatchConnector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('queryLogs', () => {
    it('should successfully fetch logs from CloudWatch', async () => {
      const mockResponse = {
        data: {
          events: [
            {
              message: 'Application started successfully',
              timestamp: 1609459200000,
              level: 'INFO',
              logStreamName: 'application-stream'
            }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new CloudWatchConnector({ region: 'us-east-1' });
      const logs = await connector.queryLogs('/aws/lambda/my-function', 'abc123');

      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Application started successfully');
      expect(logs[0].level).toBe('INFO');
      expect(logs[0].source).toBe('cloudwatch');
      expect(logs[0].deployment_sha).toBe('abc123');
    });

    it('should parse log level correctly', async () => {
      const mockResponse = {
        data: {
          events: [
            { message: 'Error occurred', timestamp: 1609459200000, level: 'ERROR', logStreamName: 'stream' },
            { message: 'Warning detected', timestamp: 1609459200000, level: 'WARN', logStreamName: 'stream' },
            { message: 'Info log', timestamp: 1609459200000, level: 'INFO', logStreamName: 'stream' },
            { message: 'Debug log', timestamp: 1609459200000, level: 'DEBUG', logStreamName: 'stream' }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new CloudWatchConnector({ region: 'us-east-1' });
      const logs = await connector.queryLogs('/aws/logs', 'sha1');

      expect(logs[0].level).toBe('ERROR');
      expect(logs[1].level).toBe('WARNING');
      expect(logs[2].level).toBe('INFO');
      expect(logs[3].level).toBe('DEBUG');
    });

    it('should include deployment SHA in tags', async () => {
      const mockResponse = {
        data: {
          events: [
            {
              message: 'Log message',
              timestamp: 1609459200000,
              level: 'ERROR',
              logStreamName: 'stream-name'
            }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new CloudWatchConnector({ region: 'us-east-1' });
      const logs = await connector.queryLogs('/aws/logs', 'abc123');

      expect(logs[0].tags.deploymentSha).toBe('abc123');
      expect(logs[0].tags.logGroupName).toBe('/aws/logs');
      expect(logs[0].tags.logStreamName).toBe('stream-name');
    });

    it('should handle empty response', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: { events: [] } })
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new CloudWatchConnector({ region: 'us-east-1' });
      const logs = await connector.queryLogs('/aws/logs', 'sha1');

      expect(logs).toHaveLength(0);
    });

    it('should handle API error', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('Connection failed'))
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new CloudWatchConnector({ region: 'us-east-1' });

      await expect(connector.queryLogs('/aws/logs', 'sha1')).rejects.toThrow('Failed to query CloudWatch logs');
    });
  });

  describe('Initialization', () => {
    it('should use provided region', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new CloudWatchConnector({ region: 'eu-west-1' });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://logs.eu-west-1.amazonaws.com'
        })
      );
    });

    it('should default to us-east-1', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new CloudWatchConnector({ region: '' });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://logs.us-east-1.amazonaws.com'
        })
      );
    });

    it('should include AWS credentials in headers if provided', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new CloudWatchConnector({
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Amz-Access-Key': 'AKIAIOSFODNN7EXAMPLE',
            'X-Amz-Secret-Key': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
          })
        })
      );
    });

    it('should use custom endpoint if provided', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new CloudWatchConnector({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566'
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://localhost:4566'
        })
      );
    });
  });

  describe('Log level parsing', () => {
    it('should map CRITICAL to ERROR', async () => {
      const mockResponse = {
        data: {
          events: [
            { message: 'Critical', timestamp: 1609459200000, level: 'CRITICAL', logStreamName: 'stream' }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new CloudWatchConnector({ region: 'us-east-1' });
      const logs = await connector.queryLogs('/aws/logs', 'sha1');

      expect(logs[0].level).toBe('ERROR');
    });

    it('should default to INFO for unknown level', async () => {
      const mockResponse = {
        data: {
          events: [
            { message: 'Unknown', timestamp: 1609459200000, level: 'TRACE', logStreamName: 'stream' }
          ]
        }
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new CloudWatchConnector({ region: 'us-east-1' });
      const logs = await connector.queryLogs('/aws/logs', 'sha1');

      expect(logs[0].level).toBe('INFO');
    });
  });

  describe('Filter pattern generation', () => {
    it('should use correct filter pattern with deployment SHA', async () => {
      const mockGet = jest.fn().mockResolvedValue({ data: { events: [] } });
      mockedAxios.create.mockReturnValue({
        get: mockGet
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new CloudWatchConnector({ region: 'us-east-1' });
      await connector.queryLogs('/aws/lambda/my-func', 'abc123xyz');

      expect(mockGet).toHaveBeenCalledWith('/api/logs/filter', expect.objectContaining({
        params: expect.objectContaining({
          logGroupName: '/aws/lambda/my-func',
          filterPattern: '[msg, deployment_sha="abc123xyz"]'
        })
      }));
    });
  });
});
