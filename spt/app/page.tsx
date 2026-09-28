import {requireChatGPTUser} from './chatgpt-auth';
import {owner} from '@/lib/server';
import Notebook from './notebook';
import {rehearsalScope} from '@/lib/rehearsal';
export const dynamic='force-dynamic';
export default async function Home(){await requireChatGPTUser('/');const scope=rehearsalScope();return <Notebook ownerKey={await owner()} rehearsalId={scope?.id} rehearsalDate={scope?.date}/>;}
