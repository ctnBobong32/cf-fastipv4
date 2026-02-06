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
        console.error('缺少KEY或SECRET环境变量');
        return;
    }

    // 1. 配置源域名和目标域名
    const sourceDomains = 'cf.090227.xyz,cf2.090227.xyz,cf3.090227.xyz';
    const targetDomain = 'cdn.262832.xyz';
    
    // 解析源域名字符串为数组
    const sourceDomainList = sourceDomains.split(',').map(s => s.trim()).filter(s => s);
    
    if (sourceDomainList.length === 0) {
        console.error('未配置有效的源域名');
        return;
    }
    
    console.log(`配置: ${sourceDomainList.length}个源域名 -> ${targetDomain}`);

    // 2. 并行解析所有源域名的IP
    console.log('开始并行解析所有源域名...');
    
    const resolvePromises = sourceDomainList.map(async (domain) => {
        try {
            console.log(`正在解析 ${domain} 的IP...`);
            const ips = await resolveA(domain);
            console.log(`${domain} 解析完成: ${ips.length}个IP`);
            return { domain, ips, success: true };
        } catch (error) {
            console.error(`解析 ${domain} 失败:`, error);
            return { domain, ips: [], success: false, error };
        }
    });

    // 等待所有解析完成
    const resolveResults = await Promise.all(resolvePromises);
    
    // 3. 汇总所有IP并去重
    const allIPs: string[] = [];
    const successfulDomains: string[] = [];
    const failedDomains: string[] = [];
    
    resolveResults.forEach(result => {
        if (result.success && result.ips.length > 0) {
            allIPs.push(...result.ips);
            successfulDomains.push(result.domain);
        } else {
            failedDomains.push(result.domain);
        }
    });
    
    // 去重IP
    const uniqueIPs = Array.from(new Set(allIPs));
    
    console.log('\n解析结果汇总:');
    console.log(`成功解析: ${successfulDomains.length}个域名`, successfulDomains);
    console.log(`解析失败: ${failedDomains.length}个域名`, failedDomains);
    console.log(`汇总IP: ${uniqueIPs.length}个（去重后）`, uniqueIPs);
    
    if (uniqueIPs.length === 0) {
        console.error('所有源域名解析失败，没有可用的IP地址');
        return;
    }
    
    // 4. 更新华为云DNS（汇总记录）
    console.log(`\n正在更新目标域名 ${targetDomain}...`);
    const endpoint = env.HUAWEI_DNS_ENDPOINT || 'dns.ap-southeast-1.myhuaweicloud.com';
    const huawei = new HuaweiDNS(env.KEY, env.SECRET, endpoint, env.PROJECT_ID);
    
    try {
        await huawei.updateRecord(targetDomain, uniqueIPs);
        console.log(`目标域名 ${targetDomain} 更新成功！`);
        console.log(`添加了 ${uniqueIPs.length} 个IP记录`);
    } catch (e) {
        console.error('更新华为云DNS失败:', e);
    }
    
    console.log('\n定时任务完成');
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
        
        // 手动触发端点
        if (url.pathname === '/trigger') {
            await handleCron(env);
            return new Response('手动触发已执行，请查看日志');
        }

		return new Response(`
CF-FastIPv4 Worker
------------------
状态: 运行中
计划: * * * * * (每分钟)

用法:
  GET /trigger - 手动触发更新
        `);
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(handleCron(env));
	},
};