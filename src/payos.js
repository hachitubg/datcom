const crypto = require('crypto');
const https = require('https');

const PAYOS_BASE_URL = process.env.PAYOS_BASE_URL || 'https://api-merchant.payos.vn';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function sortObjectByKey(value) {
  return Object.keys(value || {}).sort().reduce((result, key) => {
    const item = value[key];
    result[key] = item && typeof item === 'object' && !Array.isArray(item)
      ? sortObjectByKey(item)
      : item;
    return result;
  }, {});
}

function signatureValue(value) {
  if (value === null || value === undefined || value === 'undefined' || value === 'null') return '';
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => (
      item && typeof item === 'object' ? sortObjectByKey(item) : item
    )));
  }
  if (typeof value === 'object') return JSON.stringify(sortObjectByKey(value));
  return String(value);
}

function buildSignatureFromPayload(payload, checksumKey) {
  const dataString = Object.keys(payload || {})
    .sort()
    .filter((key) => payload[key] !== undefined)
    .map((key) => `${key}=${signatureValue(payload[key])}`)
    .join('&');

  return crypto.createHmac('sha256', checksumKey).update(dataString).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJsonOnce(urlString, { method, headers, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers
      },
      (response) => {
        let raw = '';
        let receivedBytes = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          receivedBytes += Buffer.byteLength(chunk);
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('Phản hồi PayOS vượt quá giới hạn cho phép'));
            return;
          }
          raw += chunk;
        });
        response.on('end', () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {}

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            headers: response.headers,
            data,
            raw
          });
        });
      }
    );

    request.on('error', (error) => {
      reject(error);
    });
    request.setTimeout(timeoutMs, () => {
      const timeoutError = new Error(`PayOS không phản hồi sau ${timeoutMs}ms`);
      timeoutError.code = 'PAYOS_TIMEOUT';
      request.destroy(timeoutError);
    });

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

async function requestJson(urlString, options) {
  const method = String(options.method || 'GET').toUpperCase();
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await requestJsonOnce(urlString, options);
      const retryableResponse = response.statusCode === 429
        || (method === 'GET' && response.statusCode >= 500);
      if (!retryableResponse || attempt === maxAttempts) return response;

      const retryAfterSeconds = Number(response.headers?.['retry-after'] || 0);
      const delayMs = retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : Math.min(4000, 750 * (2 ** (attempt - 1)));
      await sleep(delayMs);
    } catch (error) {
      lastError = error;
      if (method !== 'GET' || attempt === maxAttempts) throw error;
      await sleep(Math.min(4000, 750 * (2 ** (attempt - 1))));
    }
  }

  throw lastError || new Error('Không thể kết nối PayOS');
}

function getPayOSError(response, fallback) {
  const detail = response.data?.desc || response.data?.message || String(response.raw || '').trim();
  const error = new Error(detail ? `PayOS (${response.statusCode}): ${detail.slice(0, 240)}` : fallback);
  error.statusCode = response.statusCode;
  error.payOSCode = response.data?.code || '';
  return error;
}

class PayOSService {
  constructor() {
    this.clientId = process.env.PAYOS_CLIENT_ID;
    this.apiKey = process.env.PAYOS_API_KEY;
    this.checksumKey = process.env.PAYOS_CHECKSUM_KEY;
  }

  isConfigured() {
    return Boolean(this.clientId && this.apiKey && this.checksumKey);
  }

  getHeaders() {
    return {
      'x-client-id': this.clientId,
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json'
    };
  }

  async createPaymentLink(paymentData) {
    const endpoint = `${PAYOS_BASE_URL}/v2/payment-requests`;
    const payload = {
      orderCode: paymentData.orderCode,
      amount: paymentData.amount,
      description: paymentData.description,
      returnUrl: paymentData.returnUrl,
      cancelUrl: paymentData.cancelUrl,
      buyerName: paymentData.buyerName,
      expiredAt: paymentData.expiredAt
    };

    payload.signature = buildSignatureFromPayload(
      {
        amount: payload.amount,
        cancelUrl: payload.cancelUrl,
        description: payload.description,
        orderCode: payload.orderCode,
        returnUrl: payload.returnUrl
      },
      this.checksumKey
    );

    const response = await requestJson(endpoint, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok || response.data?.code !== '00') {
      throw getPayOSError(response, 'Tạo link thanh toán PayOS thất bại');
    }

    return response.data.data;
  }

  async getPaymentLinkInformation(orderCode) {
    const normalizedOrderCode = Number(orderCode);
    if (!Number.isFinite(normalizedOrderCode) || normalizedOrderCode <= 0) {
      throw new Error('Mã đơn PayOS không hợp lệ');
    }

    const endpoint = `${PAYOS_BASE_URL}/v2/payment-requests/${normalizedOrderCode}`;
    const response = await requestJson(endpoint, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok || response.data?.code !== '00') {
      throw getPayOSError(response, 'Không thể lấy trạng thái thanh toán từ PayOS');
    }

    return response.data.data;
  }

  verifyWebhook(webhookBody) {
    if (!webhookBody || !webhookBody.data || !webhookBody.signature) {
      return false;
    }

    const signature = buildSignatureFromPayload(webhookBody.data, this.checksumKey);
    const received = String(webhookBody.signature || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(received)) return false;
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(received, 'hex'));
  }
}

module.exports = PayOSService;
module.exports.buildSignatureFromPayload = buildSignatureFromPayload;
