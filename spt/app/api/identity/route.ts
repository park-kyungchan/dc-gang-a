import {owner,result,failure} from '@/lib/server';
import {env} from 'cloudflare:workers';
export const dynamic='force-dynamic';
export async function GET(){try{const ownerKey=await owner(),settings=env as unknown as Record<string,unknown>;return result({ownerKey,...(settings.SPT_BACKEND_MODE==='paired-local'&&typeof settings.SPT_BUILD_ID==='string'?{runtime:{buildId:settings.SPT_BUILD_ID,runUntil:settings.SPT_RUN_UNTIL}}:{})})}catch(e){return failure(e)}}
