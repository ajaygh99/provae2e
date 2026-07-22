import { ElasticsearchConnector } from '../../src/core/production-logs-elk.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ElasticsearchConnector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('queryLogs', () => {
    it('should successfully fetch logs from Elasticsearch', async () => {
      const mockResponse = {
        data: {
          hits: {
            hits: [
              {
                _id: 'doc1',
                _index: 'logs-2026.01.01',
                _source: {
                  level: 'ERROR',
                  message: 'Database connection failed',
                  timestamp: '2026-01-01T10:00:00.000Z',
                  deployment_sha: 'abc123',
                  tags: { service: 'api', region: 'us-east-1' }
                }
              }
            ]
          }
        }
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new ElasticsearchConnector({ url: 'http://localhost:9200' });
      const logs = await connector.queryLogs('logs-*', 'abc123');

      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('ERROR');
      expect(logs[0].message).toBe('Database connection failed');
      expect(logs[0].source).toBe('elk');
    });

    it('should parse log level correctly', async () => {
      const mockResponse = {
        data: {
          hits: {
            hits: [
              { _id: '1', _index: 'logs', _source: { level: 'ERROR', message: 'E', timestamp: '2026-01-01T10:00:00.000Z', deployment_sha: 'a1', tags: {} } },
              { _id: '2', _index: 'logs', _source: { level: 'WARNING', message: 'W', timestamp: '2026-01-01T10:00:00.000Z', deployment_sha: 'a1', tags: {} } },
              { _id: '3', _index: 'logs', _source: { level: 'INFO', message: 'I', timestamp: '2026-01-01T10:00:00.000Z', deployment_sha: 'a1', tags: {} } },
              { _id: '4', _index: 'logs', _source: { level: 'DEBUG', message: 'D', timestamp: '2026-01-01T10:00:00.000Z', deployment_sha: 'a1', tags: {} } }
            ]
          }
        }
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new ElasticsearchConnector({ url: 'http://localhost:9200' });
      const logs = await connector.queryLogs('logs-*', 'a1');

      expect(logs[0].level).toBe('ERROR');
      expect(logs[1].level).toBe('WARNING');
      expect(logs[2].level).toBe('INFO');
      expect(logs[3].level).toBe('DEBUG');
    });

    it('should extract tags from source', async () => {
      const mockResponse = {
        data: {
          hits: {
            hits: [
              {
                _id: 'doc1',
                _index: 'logs-prod',
                _source: {
                  level: 'ERROR',
                  message: 'Error',
                  timestamp: '2026-01-01T10:00:00.000Z',
                  deployment_sha: 'abc123',
                  tags: { service: 'api', version: '1.2.3', region: 'eu-west-1' }
                }
              }
            ]
          }
        }
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new ElasticsearchConnector({ url: 'http://localhost:9200' });
      const logs = await connector.queryLogs('logs-*', 'abc123');

      expect(logs[0].tags).toEqual({
        index: 'logs-prod',
        docId: 'doc1',
        service: 'api',
        version: '1.2.3',
        region: 'eu-west-1'
      });
    });

    it('should handle empty response', async () => {
      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue({ data: { hits: { hits: [] } } })
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new ElasticsearchConnector({ url: 'http://localhost:9200' });
      const logs = await connector.queryLogs('logs-*', 'sha1');

      expect(logs).toHaveLength(0);
    });

    it('should handle API error', async () => {
      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(new Error('Connection refused'))
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new ElasticsearchConnector({ url: 'http://localhost:9200' });

      await expect(connector.queryLogs('logs-*', 'sha1')).rejects.toThrow('Failed to query Elasticsearch logs');
    });
  });

  describe('Initialization', () => {
    it('should use provided URL', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new ElasticsearchConnector({ url: 'https://elastic.example.com:9200' });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://elastic.example.com:9200'
        })
      );
    });

    it('should include basic auth if username and password provided', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new ElasticsearchConnector({
        url: 'http://localhost:9200',
        username: 'elastic',
        password: 'changeme'
      });

      const expectedAuth = Buffer.from('elastic:changeme').toString('base64');
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Basic ${expectedAuth}`
          })
        })
      );
    });

    it('should include API key auth if provided', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new ElasticsearchConnector({
        url: 'http://localhost:9200',
        apiKey: 'VnVhQ2x1c3RlcjpRYW56ajI5ajAxMnR2MzhhOTJ4dHo5NA=='
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'ApiKey VnVhQ2x1c3RlcjpRYW56ajI5ajAxMnR2MzhhOTJ4dHo5NA=='
          })
        })
      );
    });

    it('should set Content-Type header', () => {
      const createSpy = jest.spyOn(axios, 'create');
      mockedAxios.create.mockReturnValue({} as unknown as ReturnType<typeof axios.create>);

      new ElasticsearchConnector({ url: 'http://localhost:9200' });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });
  });

  describe('Log level parsing', () => {
    it('should map FATAL to ERROR', async () => {
      const mockResponse = {
        data: {
          hits: {
            hits: [
              { _id: '1', _index: 'logs', _source: { level: 'FATAL', message: 'Fatal', timestamp: '2026-01-01T10:00:00.000Z', deployment_sha: 'a1', tags: {} } }
            ]
          }
        }
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new ElasticsearchConnector({ url: 'http://localhost:9200' });
      const logs = await connector.queryLogs('logs-*', 'a1');

      expect(logs[0].level).toBe('ERROR');
    });

    it('should default to INFO for unknown level', async () => {
      const mockResponse = {
        data: {
          hits: {
            hits: [
              { _id: '1', _index: 'logs', _source: { level: 'TRACE', message: 'Trace', timestamp: '2026-01-01T10:00:00.000Z', deployment_sha: 'a1', tags: {} } }
            ]
          }
        }
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new ElasticsearchConnector({ url: 'http://localhost:9200' });
      const logs = await connector.queryLogs('logs-*', 'a1');

      expect(logs[0].level).toBe('INFO');
    });

    it('should default to INFO if level is missing', async () => {
      const mockResponse = {
        data: {
          hits: {
            hits: [
              { _id: '1', _index: 'logs', _source: { message: 'No level', timestamp: '2026-01-01T10:00:00.000Z', deployment_sha: 'a1', tags: {} } }
            ]
          }
        }
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue(mockResponse)
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new ElasticsearchConnector({ url: 'http://localhost:9200' });
      const logs = await connector.queryLogs('logs-*', 'a1');

      expect(logs[0].level).toBe('INFO');
    });
  });

  describe('Query DSL generation', () => {
    it('should send correct query DSL to Elasticsearch', async () => {
      const mockPost = jest.fn().mockResolvedValue({ data: { hits: { hits: [] } } });
      mockedAxios.create.mockReturnValue({
        post: mockPost
      } as unknown as ReturnType<typeof axios.create>);

      const connector = new ElasticsearchConnector({ url: 'http://localhost:9200' });
      await connector.queryLogs('logs-prod-*', 'abc123xyz');

      expect(mockPost).toHaveBeenCalledWith(
        '/logs-prod-*/_search',
        expect.objectContaining({
          query: expect.objectContaining({
            bool: expect.objectContaining({
              must: expect.arrayContaining([
                { match: { deployment_sha: 'abc123xyz' } }
              ])
            })
          }),
          size: 1000,
          sort: [{ timestamp: { order: 'desc' } }]
        })
      );
    });
  });
});
