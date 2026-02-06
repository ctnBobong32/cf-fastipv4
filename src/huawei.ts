// huawei.ts
import { HuaweiSigner } from './signer';

export class HuaweiDNS {
  private signer: HuaweiSigner;
  private endpoint: string;

  constructor(
    ak: string,
    sk: string,
    endpoint: string = 'dns.ap-southeast-1.myhuaweicloud.com',
    projectId?: string
  ) {
  
    this.signer = new HuaweiSigner(ak, sk, projectId);
    this.endpoint = endpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }

  /** 统一构造 URL，避免出现 //v2/... 之类问题 */
  private buildUrl(path: string): string {
    const p = ('/' + path).replace(/\/{2,}/g, '/');
    return `https://${this.endpoint}${p}`;
  }

  /** 统一请求封装：签名 + fetch + 错误处理 */
  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = this.buildUrl(path);

    const headers = new Headers();
    // 注意：你如果要签 content-type，就必须真的带上它（我们这里始终带）
    headers.set('Content-Type', 'application/json');

    const isBodyAllowed = method !== 'GET' && method !== 'HEAD';
    const reqInit: RequestInit = {
      method,
      headers,
      body: isBodyAllowed ? (body !== undefined ? JSON.stringify(body) : undefined) : undefined,
    };

    let req = new Request(url, reqInit);
    req = await this.signer.sign(req);

    console.log(`华为云API请求: ${method} ${url}`);
    const res = await fetch(req);

    const resText = await res.text();
    let resData: any = resText;
    try {
      resData = JSON.parse(resText);
    } catch {
      // keep as text
    }

    if (!res.ok) {
      console.error(`华为云API错误: ${res.status} ${res.statusText}`, resData);
      throw new Error(`华为云API调用失败: ${JSON.stringify(resData)}`);
    }

    return resData;
  }

  async getZoneId(domain: string): Promise<string | null> {
    console.log(`查找域名 ${domain} 对应的区域...`);

    const domainWithDot = domain.endsWith('.') ? domain : domain + '.';

    try {
      const data = await this.request('GET', '/v2/zones?type=public');

      if (!data?.zones || !Array.isArray(data.zones)) {
        console.warn('获取到的 zones 列表为空或格式异常。');
        return null;
      }

      let bestMatch: any = null;
      for (const zone of data.zones) {
        if (!zone?.name || !zone?.id) continue;

        if (domainWithDot.endsWith(zone.name)) {
          if (!bestMatch || zone.name.length > bestMatch.name.length) {
            bestMatch = zone;
          }
        }
      }

      if (bestMatch) {
        console.log(`找到区域: ${bestMatch.name} (${bestMatch.id})`);
        return bestMatch.id;
      }

      console.warn(`未找到与 ${domainWithDot} 匹配的区域（zone）。`);
      return null;
    } catch (e) {
      console.error('获取区域列表时出错:', e);
      return null;
    }
  }

  async updateRecord(domain: string, ips: string[]) {
    console.log(`正在更新记录 ${domain}，新的IP地址为:`, ips);

    const zoneId = await this.getZoneId(domain);
    if (!zoneId) {
      throw new Error(`找不到域名 ${domain} 对应的区域`);
    }

    const fqdn = domain.endsWith('.') ? domain : domain + '.';

    const searchPath =
      `/v2/zones/${zoneId}/recordsets?name=${encodeURIComponent(fqdn)}&type=A`;
    const searchRes = await this.request('GET', searchPath);

    let existingRecord: any = null;
    if (searchRes?.recordsets && Array.isArray(searchRes.recordsets) && searchRes.recordsets.length > 0) {
      existingRecord = searchRes.recordsets.find((r: any) => r?.name === fqdn && r?.type === 'A');
    }

    const body = {
      name: fqdn,
      type: 'A',
      ttl: 60,
      records: ips,
    };

    if (existingRecord?.id) {
      console.log(`记录已存在（${existingRecord.id}），正在更新...`);
      await this.request('PUT', `/v2/zones/${zoneId}/recordsets/${existingRecord.id}`, body);
      console.log('记录更新成功。');
    } else {
      console.log('记录不存在，正在创建...');
      await this.request('POST', `/v2/zones/${zoneId}/recordsets`, body);
      console.log('记录创建成功。');
    }
  }
}