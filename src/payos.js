const crypto = require('crypto');
const https = require('https');

const PAYOS_BASE_URL = process.env.PAYOS_BASE_URL || 'https://api-merchant.payos.vn';

function buildSignatureFromPayload(payload, checksumKey) {
  const sortedKeys = Object.keys(payload).sort();
  const dataString = sortedKeys
    .filter((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
    .map((key) => `${key}=${payload[key]}`)
    .join('&');

  return crypto.createHmac('sha256', checksumKey).update(dataString).digest('hex');
}

function requestJson(urlString, { method, headers, body }) {
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
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          let data = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch (parseError) {
            reject(new Error(`Phản hồi PayOS không hợp lệ: ${parseError.message}`));
            return;
          }

          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            data
          });
        });
      }
    );

    request.on('error', (error) => {
      reject(error);
    });

    if (body) {
      request.write(body);
    }

    request.end();
  });
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

    if (!response.ok || response.data.code !== '00') {
      throw new Error(response.data.desc || response.data.message || 'Tạo link thanh toán PayOS thất bại');
    }

    return response.data.data;
  }

  verifyWebhook(webhookBody) {
    if (!webhookBody || !webhookBody.data || !webhookBody.signature) {
      return false;
    }

    const signature = buildSignatureFromPayload(webhookBody.data, this.checksumKey);
    return signature === webhookBody.signature;
  }
}

module.exports = PayOSService;
