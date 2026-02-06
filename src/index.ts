
import { resolveA } from './dns';
import { HuaweiDNS } from './huawei';

export interface Env {
	KEY: string;
	SECRET: string;
    HUAWEI_DNS_ENDPOINT?: string;
    PROJECT_ID?: string;
}

async function handleCron(env: Env) {
    console.log('Starting Cron Job...');
    
    if (!env.KEY || !env.SECRET) {
        console.error('Missing KEY or SECRET environment variables.');
        return;
    }

    const sourceDomain = 'cf.090227.xyz';
    const targetDomain = 'cdn.262832.xyz';

    // 1. Resolve IPs
    console.log(`Resolving IPs for ${sourceDomain}...`);
    const ips = await resolveA(sourceDomain);
    if (ips.length === 0) {
        console.error('No IPs found from source domain. Aborting update.');
        return;
    }
    console.log(`Got ${ips.length} IPs:`, ips);

    // 2. Update Huawei DNS
    const endpoint = env.HUAWEI_DNS_ENDPOINT || 'dns.myhuaweicloud.com';
    const huawei = new HuaweiDNS(env.KEY, env.SECRET, endpoint, env.PROJECT_ID);
    try {
        await huawei.updateRecord(targetDomain, ips);
    } catch (e) {
        console.error('Failed to update Huawei DNS:', e);
    }
    
    console.log('Cron Job Finished.');
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
        
        // Manual trigger endpoint
        if (url.pathname === '/trigger') {
            await handleCron(env);
            return new Response('Manual trigger executed. Check logs.');
        }

		return new Response(`
CF-FastIPv4 Worker
------------------
Status: Running
Schedule: * * * * * (Every minute)

Usage:
  GET /trigger  - Manually trigger the update
        `);
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(handleCron(env));
	},
};
