const DOH_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
  'https://dns.quad9.net/dns-query',
  'https://doh.opendns.com/dns-query',
  // 'https://dns.alidns.com/resolve',     // 阿里DNS (从Workers可能较慢)
  // 'https://doh.pub/dns-query'          // DNSPod
];

async function queryDoh(provider: string, domain: string): Promise<string[]> {
  try {
    const url = new URL(provider);
    url.searchParams.set('name', domain);
    url.searchParams.set('type', 'A');
    // Google DNS使用'type=A'参数，但也通常检查'Accept'头部。
    // 一些提供商可能不完全支持/dns-query路径上的application/dns-json，
    // 但标准是使用`name`和`type`参数。

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/dns-json' }
    });

    if (!res.ok) {
      // console.warn(`DoH查询失败 ${provider}: ${res.status}`);
      return [];
    }

    const data: any = await res.json();
    if (!data.Answer) {
      return [];
    }

    return data.Answer
      .filter((record: any) => record.type === 1) // 1代表A记录
      .map((record: any) => record.data);
  } catch (error) {
    // console.warn(`查询${provider}时出错:`, error);
    return [];
  }
}

/**
 * 使用多个DoH提供商解析域名的A记录
 * @param domain - 要解析的域名
 * @returns 返回去重后的IP地址数组
 */
export async function resolveA(domain: string): Promise<string[]> {
  console.log(`正在使用多个DoH提供商解析 ${domain} 的A记录...`);
  
  // 并行查询多个提供商以获取更广泛的IP集合
  // 因为DNS轮询通常返回不同的IP子集
  const promises = DOH_PROVIDERS.map(provider => queryDoh(provider, domain));
  
  // 额外添加对Cloudflare和Google的重复查询，尝试捕获轮询变化
  promises.push(queryDoh('https://cloudflare-dns.com/dns-query', domain));
  promises.push(queryDoh('https://dns.google/resolve', domain));

  const results = await Promise.all(promises);
  
  const uniqueIps = new Set<string>();
  results.flat().forEach(ip => {
      if (ip && typeof ip === 'string') {
          uniqueIps.add(ip);
      }
  });

  const ips = Array.from(uniqueIps);
  console.log(`为 ${domain} 解析到 ${ips.length} 个唯一IP地址:`, ips);
  
  if (ips.length === 0) {
      console.warn(`未从任何提供商找到 ${domain} 的IP地址。`);
  }

  return ips;
}