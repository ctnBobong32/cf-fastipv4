import { resolveA } from './dns';
import { HuaweiDNS } from './huawei';

export interface Env {
  KEY: string;
  SECRET: string;
  HUAWEI_DNS_ENDPOINT?: string;
  PROJECT_ID?: string;
}

async function handleCron(env: Env) {
  console.log('开始定时任务...');

  if (!env.KEY || !env.SECRET) {
    console.error('缺少 KEY 或 SECRET 环境变量，任务终止。');
    return;
  }

  const sourceDomains = [
    'cf.090227.xyz',
    'staticdelivery.nexusmods.com',
    'saas.sin.fan',
  ];

  const targetDomain = 'cf.cdn.262832.xyz';

  console.log(`配置: ${sourceDomains.length} 个源域名 -> ${targetDomain}`);
  console.log('开始并行解析所有源域名...');

  // 并行解析
  const settled = await Promise.allSettled(
    sourceDomains.map(async (domain) => {
      console.log(`正在解析 ${domain} 的 IP...`);
      const ips = await resolveA(domain);
      const uniqueIps = Array.from(new Set(ips));
      console.log(`${domain} 解析完成: ${uniqueIps.length} 个 IP`);
      return { domain, ips: uniqueIps };
    })
  );

  const ok: Array<{ domain: string; ips: string[] }> = [];
  const failed: Array<{ domain: string; reason: unknown }> = [];

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const domain = sourceDomains[i];
    if (r.status === 'fulfilled') ok.push(r.value);
    else failed.push({ domain, reason: r.reason });
  }

  console.log('解析结果汇总:');
  ok.forEach(({ domain, ips }) => console.log(`- ${domain}: ${ips.length} 个 IP`));

  if (failed.length > 0) {
    console.warn(`解析失败: ${failed.length} 个域名`);
    failed.forEach((f) => console.warn(`- ${f.domain} 失败原因:`, f.reason));
  } else {
    console.log('成功解析: 全部域名');
  }

  // 合并去重
  const mergedIps = Array.from(new Set(ok.flatMap(x => x.ips)));
  console.log(`汇总IP: ${mergedIps.length} 个（去重后）`);

  if (mergedIps.length === 0) {
    console.error('没有可用 IP，任务终止。');
    return;
  }

  // 更新华为云 DNS
  const endpoint = env.HUAWEI_DNS_ENDPOINT || 'dns.myhuaweicloud.com';
  const huawei = new HuaweiDNS(env.KEY, env.SECRET, endpoint, env.PROJECT_ID);

  console.log(`正在更新目标域名 ${targetDomain}，新的 IP 地址为: ${mergedIps.join(', ')}`);

  try {
    await huawei.updateRecord(targetDomain, mergedIps);
    console.log('华为云 DNS 更新成功。');
  } catch (e) {
    console.error('更新华为云 DNS 失败:', e);
  }

  console.log('定时任务完成。');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 手动触发
    if (url.pathname === '/trigger') {
      await handleCron(env);
      return new Response('已手动触发执行，请查看日志。');
    }

    return new Response(
      [
        'CF-FastIPv4 Worker',
        '------------------',
        '状态: 运行中',
        '计划任务: * * * * *（每分钟）',
        '',
        '使用方法:',
        '  GET /trigger  - 手动触发更新',
      ].join('\n'),
      { headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env));
  },
};
