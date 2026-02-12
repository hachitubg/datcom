const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

const PAYOS_BASE_URL = process.env.PAYOS_BASE_URL || 'https://api-merchant.payos.vn';

function buildSignatureFromPayload(payload, checksumKey) {
  const sortedKeys = Object.keys(payload).sort();
  const dataString = sortedKeys
    .filter((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
    .map((key) => `${key}=${payload[key]}`)
    .join('&');

  return crypto.createHmac('sha256', checksumKey).update(dataString).digest('hex');
}

function postJson(requestUrl, headers, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(requestUrl);
    const body = JSON.stringify(payload);

    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: Object.assign({}, headers, {
          'Content-Length': Buffer.byteLength(body)
        })
      },
      (res) => {
        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData || '{}');
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.desc || parsed.message || `PayOS HTTP ${res.statusCode}`));
            }
          } catch (parseError) {
            reject(new Error(`Không parse được phản hồi PayOS: ${parseError.message}`));
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
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

    const data = await postJson(endpoint, this.getHeaders(), payload);
    if (data.code !== '00') {
      throw new Error(data.desc || data.message || 'Tạo link thanh toán PayOS thất bại');
    }

    return data.data;
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
