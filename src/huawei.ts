import { HuaweiSigner } from './signer';

export class HuaweiDNS {
  private signer: HuaweiSigner;
  private endpoint: string;

  constructor(accessKey: string, secretKey: string, endpoint: string = 'dns.ap-southeast-1.myhuaweicloud.com', projectId?: string) {
    this.signer = new HuaweiSigner(accessKey, secretKey, projectId);
    this.endpoint = endpoint;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `https://${this.endpoint}${path}`;
    const headers = new Headers({
      'Content-Type': 'application/json'
    });

    const reqInit: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    };

    let req = new Request(url, reqInit);
    req = await this.signer.sign(req);

    console.log(`华为云API请求: ${method} ${url}`);
    const res = await fetch(req);
    
    const resText = await res.text();
    let resData;
    try {
        resData = JSON.parse(resText);
    } catch {
        resData = resText;
    }

    if (!res.ok) {
      console.error(`华为云API错误: ${res.status} ${res.statusText}`, resData);
      throw new Error(`华为云API调用失败: ${JSON.stringify(resData)}`);
    }

    return resData;
  }

  async getZoneId(domain: string): Promise<string | null> {
    // 获取区域ID以便找到最佳匹配
    // API: GET /v2/zones (V2 API通常用于公共区域，可避免某些端点的APIGW.0101问题)
    console.log(`查找域名 ${domain} 对应的区域...`);
    try {
      const data = await this.request('GET', '/v2/zones?type=public');
      if (data.zones) {
        // 查找与域名后缀匹配的区域（最长匹配）
        // 注意：区域名通常以'.'结尾
        const domainWithDot = domain.endsWith('.') ? domain : domain + '.';
        
        let bestMatch: any = null;

        for (const zone of data.zones) {
           if (domainWithDot.endsWith(zone.name)) {
             if (!bestMatch || zone.name.length > bestMatch.name.length) {
               bestMatch = zone;
             }
           }
        }

        if (bestMatch) {
          console.log(`找到区域: ${bestMatch.name} (ID: ${bestMatch.id})`);
          return bestMatch.id;
        }
      }
    } catch (e) {
      console.error('获取区域列表时出错:', e);
    }
    return null;
  }

  async updateRecord(domain: string, ipList: string[]) {
    console.log(`正在更新记录 ${domain}，新的IP地址为:`, ipList);
    
    const zoneId = await this.getZoneId(domain);
    if (!zoneId) {
      throw new Error(`找不到域名 ${domain} 对应的区域`);
    }

    // 确保域名以点结尾，便于API搜索/匹配
    // API通常接受带或不带点的完全限定域名
    const fullDomainName = domain.endsWith('.') ? domain : domain + '.';

    // 检查记录是否存在
    // 使用 /v2/ API 查询记录集
    const searchResult = await this.request('GET', `/v2/zones/${zoneId}/recordsets?name=${fullDomainName}&type=A`);
    
    let existingRecord = null;
    if (searchResult.recordsets && searchResult.recordsets.length > 0) {
        // 精确匹配检查
        existingRecord = searchResult.recordsets.find((r: any) => r.name === fullDomainName && r.type === 'A');
    }

    if (existingRecord) {
      console.log(`记录已存在 (ID: ${existingRecord.id})。正在更新...`);
      // 更新现有记录
      // PUT /v2/zones/{zone_id}/recordsets/{recordset_id}
      const requestBody = {
        name: fullDomainName,
        type: 'A',
        ttl: 60, // 根据"快速IPv4"的要求，将TTL设为60秒（通常是较短的TTL）
        records: ipList
      };
      await this.request('PUT', `/v2/zones/${zoneId}/recordsets/${existingRecord.id}`, requestBody);
      console.log('记录更新成功');
    } else {
      console.log('记录不存在。正在创建...');
      // 创建新记录
      // POST /v2/zones/{zone_id}/recordsets
      const requestBody = {
        name: fullDomainName,
        type: 'A',
        ttl: 60,
        records: ipList
      };
      await this.request('POST', `/v2/zones/${zoneId}/recordsets`, requestBody);
      console.log('记录创建成功');
    }
  }
}