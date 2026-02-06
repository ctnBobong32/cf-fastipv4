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
    
    // 1. 设置X-Sdk-Date头
    const date = new Date();
    // 格式: YYYYMMDDTHHMMSSZ
    const isoDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    request.headers.set('X-Sdk-Date', isoDate);
    // 确保Host头已设置
    request.headers.set('Host', url.host);

    // 如果配置了项目ID，设置X-Project-Id头
    if (this.projectId) {
        request.headers.set('X-Project-Id', this.projectId);
    }

    // 2. 构建规范请求
    
    // 2.1 请求方法
    // 2.2 规范URI
    // "用于签名的URI必须以斜杠(/)结尾"
    let canonicalUri = url.pathname;
    if (!canonicalUri.endsWith('/')) {
        canonicalUri += '/';
    }
    // 注意：如果路径名为空，则变为"/"

    // 2.3 规范查询字符串
    const params = Array.from(url.searchParams.entries());
    params.sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQueryString = params.map(([k, v]) => 
        `${this.encode(k)}=${this.encode(v)}`
    ).join('&');

    // 2.4 规范请求头
    const headersToSign = ['host', 'x-sdk-date'];
    if (request.headers.has('content-type')) {
        headersToSign.push('content-type');
    }
    // 如果存在X-Project-Id头，则添加到签名头列表中
    if (request.headers.has('x-project-id')) {
        headersToSign.push('x-project-id');
    }
    headersToSign.sort();
    
    const canonicalHeaders = headersToSign.map(h => {
        const value = request.headers.get(h) || '';
        return `${h}:${value.trim()}`;
    }).join('\n') + '\n';

    // 2.5 签名头列表
    const signedHeaders = headersToSign.join(';');

    // 2.6 请求体哈希
    let body = '';
    if (request.body) {
        // 需要读取请求体。由于Workers中的请求体可能是流，
        // 我们假设对于API调用，我们传递的是字符串或null。
        // 为了安全起见，在这个特定用例中，我们假设克隆它或者它很小。
        try {
            const clone = request.clone();
            body = await clone.text();
        } catch (e) {
            console.warn('读取请求体用于签名失败', e);
        }
    }
    const payloadHash = createHash('sha256').update(body).digest('hex');

    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');

    // 3. 待签名字符串
    const algorithm = 'SDK-HMAC-SHA256';
    const stringToSign = [
        algorithm,
        isoDate,
        createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    // 4. 计算签名
    const signature = createHmac('sha256', this.sk)
        .update(stringToSign)
        .digest('hex');

    // 5. 构建Authorization头
    const auth = `${algorithm} Access=${this.ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    request.headers.set('Authorization', auth);

    return request;
  }

  private encode(str: string): string {
    return encodeURIComponent(str)
        .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }
}