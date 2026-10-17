import {emptyState, reduce} from './core.mjs';
const config = window.LADDER_CONFIG || {};
const base = (config.supabaseUrl || '').replace(/\/$/, '');
const key = config.supabasePublishableKey || '';
export const demo = !base || !key;
const DEMO_KEY = 'endless-ladder-demo-v1';
let session = null, refreshPromise = null;
try { session = JSON.parse(sessionStorage.getItem('ladder-auth') || 'null'); } catch {}
function saveSession(value) { session = value; try { if(value) sessionStorage.setItem('ladder-auth', JSON.stringify(value)); else sessionStorage.removeItem('ladder-auth'); } catch {} }
function loadDemo() {
  try { const d = JSON.parse(localStorage.getItem(DEMO_KEY)); if(d?.state?.players && Array.isArray(d.history)) return {...d,checkpoints:d.checkpoints||[]}; } catch {}
  return {state:emptyState(), history:[], checkpoints:[]};
}
async function request(path, {method='GET', body, auth=false, headers={}} = {}) {
  if (auth && !session) throw Error('Sign in to edit the tournament.');
  const response = await fetch(`${base}${path}`, {
    method, headers:{apikey:key, ...(auth ? {Authorization:`Bearer ${session.access_token}`} : {}), 'Content-Type':'application/json', ...headers},
    ...(body !== undefined ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000), cache:'no-store',
  });
  const text = await response.text(); let value;
  try { value = text ? JSON.parse(text) : null; } catch { throw Error('Unexpected server response. Check your project URL.'); }
  if(!response.ok) throw Error(value?.msg || value?.message || value?.error_description || value?.error || `Request failed (${response.status}).`);
  return value;
}
async function freshSession() {
  if (!session || session.expires_at > Date.now()/1000 + 60) return;
  if (!refreshPromise) refreshPromise = request('/auth/v1/token?grant_type=refresh_token', {method:'POST',body:{refresh_token:session.refresh_token}})
    .then(s => saveSession({...s, expires_at:Date.now()/1000+s.expires_in}))
    .catch(e => { saveSession(null); throw e; }).finally(() => {refreshPromise = null;});
  await refreshPromise;
}
export async function login(email, password) {
  const s = await request('/auth/v1/token?grant_type=password', {method:'POST',body:{email,password}});
  saveSession({...s, expires_at:Date.now()/1000+s.expires_in});
  try { if(!await request('/rest/v1/rpc/ladder_is_editor',{method:'POST',body:{},auth:true})) throw Error('This account is not on the organizer list.'); }
  catch(e){saveSession(null); throw e;}
}
export async function logout() {try{if(session) await request('/auth/v1/logout',{method:'POST',auth:true});}finally{saveSession(null);} }
export async function canEdit() {
  if(demo) return true;
  if(!session) return false;
  try {
    await freshSession();
    return !!await request('/rest/v1/rpc/ladder_is_editor',{method:'POST',body:{},auth:true});
  } catch { return false; }
}
export async function board() {
  if(demo) return loadDemo().state;
  const rows = await request('/rest/v1/ladder_board?id=eq.1&select=state');
  if(!rows.length) throw Error('Tournament not initialized. Run supabase/setup.sql first.');
  return rows[0].state;
}
export async function mutate(state, action, payload, requestId) {
  if(demo) {
    const data = loadDemo();
    if(data.state.version !== state.version) throw Error('The board changed in another tab. Refresh and try again.');
    const updated = reduce(data.state, data.history, action, payload, undefined, undefined, data.checkpoints);
    try {localStorage.setItem(DEMO_KEY, JSON.stringify(updated));} catch {throw Error('Cannot save this demo. Browser storage may be full or disabled.');}
    return updated.state;
  }
  await freshSession();
  return await request('/rest/v1/rpc/ladder_action',{method:'POST',auth:true,body:{p_action:action,p_payload:payload,p_version:state.version,p_request_id:requestId}});
}
export async function matches({page=0, player='', kind='', status='', limit=50}={}) {
  if(demo) return loadDemo().history.filter(m => (!player || [m.winner_id,m.loser_id].includes(player)) && (!kind || m.kind===kind) && (!status || (status==='ignored'?!!m.ignored:!m.ignored))).slice(page*limit,(page+1)*limit);
  const params = new URLSearchParams({select:'*',order:'played_at.desc,id.desc',limit:String(limit),offset:String(page*limit)});
  if(player) params.set('or',`(winner_id.eq.${player},loser_id.eq.${player})`);
  if(kind) params.set('kind',`eq.${kind}`);
  if(status) params.set('ignored',`eq.${status==='ignored'}`);
  return await request(`/rest/v1/ladder_matches?${params}`);
}
export async function matchCount() {
  if(demo) return loadDemo().history.length;
  return await request('/rest/v1/rpc/ladder_match_count',{method:'POST',body:{}});
}
