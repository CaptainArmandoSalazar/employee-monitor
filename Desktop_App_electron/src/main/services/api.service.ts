import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000/api/v1';

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

function request<T>(
  method: string,
  endpoint: string,
  body?: unknown,
  token?: string
): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + endpoint);
    const bodyStr = body ? JSON.stringify(body) : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

    const lib = url.protocol === 'https:' ? https : http;
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 15000,
    };

    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let data: T;
        try {
          data = JSON.parse(raw) as T;
        } catch {
          data = raw as unknown as T;
        }
        resolve({ ok: (res.statusCode ?? 0) < 400, status: res.statusCode ?? 0, data });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export const apiService = {
  post: <T>(endpoint: string, body: unknown, token?: string) =>
    request<T>('POST', endpoint, body, token),

  get: <T>(endpoint: string, token?: string, params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<T>('GET', endpoint + query, undefined, token);
  },

  patch: <T>(endpoint: string, body: unknown, token?: string) =>
    request<T>('PATCH', endpoint, body, token),

  delete: <T>(endpoint: string, token?: string) =>
    request<T>('DELETE', endpoint, undefined, token),
};
