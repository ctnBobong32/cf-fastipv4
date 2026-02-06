import { createHash, createHmac } from 'node:crypto';

export class HuaweiSigner {
  private ak: string;
  private sk: string;
  private projectId?: string;

  constructor(ak: string, sk: string, projectId?: string) {
    this.ak = ak;
    this.sk = sk;
    this.projectId = projectId;
  }

  public async sign(request: Request): Promise<Request> {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    // 1) 设置 X-Sdk-Date（YYYYMMDDTHHMMSSZ）
    const isoDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    request.headers.set('X-Sdk-Date', isoDate);
    
    if (this.projectId) {
      request.headers.set('X-Project-Id', this.projectId);
    }

    // 2) 构建规范请求
    const canonicalUri = url.pathname && url.pathname.length > 0 ? url.pathname : '/';
    const params = Array.from(url.searchParams.entries());
    params.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
    const canonicalQueryString = params
      .map(([k, v]) => `${this.encode(k)}=${this.encode(v)}`)
      .join('&');

    // 2.4 规范请求头（全部小写）
    // host 必须参与签名，但它的值不要从 request.headers 取，直接用 url.host
    const headersToSign: string[] = ['host', 'x-sdk-date'];

    if (request.headers.has('content-type')) {
      headersToSign.push('content-type');
    }
    if (request.headers.has('x-project-id')) {
      headersToSign.push('x-project-id');
    }

    headersToSign.sort();

    const canonicalHeaders =
      headersToSign
        .map((h) => {
          let value = '';
          if (h === 'host') value = url.host;
          else value = request.headers.get(h) ?? '';
          return `${h}:${value.trim()}`;
        })
        .join('\n') + '\n';

    // 2.5 签名头列表
    const signedHeaders = headersToSign.join(';');

    // 2.6 请求体哈希
    // GET/HEAD 通常无 body；不要强行读流（减少不确定性）
    let bodyText = '';
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        bodyText = await request.clone().text();
      } catch (e) {
        console.warn('读取请求体用于签名失败', e);
        bodyText = '';
      }
    }
    const payloadHash = createHash('sha256').update(bodyText).digest('hex');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    // 3) 待签名字符串
    const algorithm = 'SDK-HMAC-SHA256';
    const stringToSign = [
      algorithm,
      isoDate,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    // 4) 计算签名
    const signature = createHmac('sha256', this.sk).update(stringToSign).digest('hex');

    // 5) Authorization 头
    const auth = `${algorithm} Access=${this.ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    request.headers.set('Authorization', auth);

    return request;
  }

  private encode(str: string): string {
    return encodeURIComponent(str).replace(
      /[!'()*]/g,
      (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
    );
  }
}