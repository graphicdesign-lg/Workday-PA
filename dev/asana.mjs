const base = 'https://app.asana.com/api/1.0/';
const gid = /^\d{1,30}$/;

function fail(message, statusCode, code) {
 return Object.assign(Error(message), {statusCode, code});
}

export const taskFields = 'gid,name,notes,assignee.gid,assignee.name,due_on,completed,modified_at,permalink_url,workspace.gid';
export const storyFields = 'gid,comment_gid,anchor_gid,created_at,created_by.name,text,resource_subtype';

export function createAsanaClient({fetchRequest = globalThis.fetch} = {}) {
 let retryUntil = 0;

 async function request(auth, endpoint, params = {}, {method = 'GET', data} = {}) {
  if (!auth) throw fail('Connect Asana in Connections first.', 409, 'connection_required');
  if (Date.now() < retryUntil) throw fail('Asana asked the app to wait before retrying.', 429, 'rate_limited');
  const url = new URL(endpoint, base);
  if (!url.href.startsWith(base)) throw fail('Invalid Asana endpoint.', 400);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try {
   response = await fetchRequest(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: {Authorization: 'Bearer ' + auth, Accept: 'application/json', ...(data && {'Content-Type':'application/json'})},
    ...(data && {body: JSON.stringify({data})})
   });
  } catch (error) {
   if (method === 'GET') throw error;
   throw fail('Asana did not confirm the write. Check the task in Asana before trying again.', 502, 'write_unconfirmed');
  }
  if (response.status === 429) {
   const after = response.headers.get('retry-after');
   const delay = after && /^\d+$/.test(after) ? Date.now() + Number(after) * 1000 : Date.parse(after);
   retryUntil = Math.max(Date.now() + 1000, delay || Date.now() + 60000);
  }
  if (!response.ok) {
   if (method !== 'GET' && response.status >= 500) {
    throw fail('Asana did not confirm the write. Check the task in Asana before trying again.', 502, 'write_unconfirmed');
   }
   const details = {
    400: ['Asana rejected the requested fields or comment.', 'invalid_request'],
    401: ['Reconnect Asana in Connections.', 'reauthentication_required'],
    402: ['Asana workspace search requires premium access.', 'premium_required'],
    403: ['The connected Asana account lacks access for this action.', 'forbidden'],
    404: ['Asana could not find the requested record.', 'not_found'],
    429: ['Asana asked the app to wait before retrying.', 'rate_limited']
   }[response.status];
   if (details) throw fail(details[0], response.status, details[1]);
   throw fail('Asana request failed (HTTP ' + response.status + ').', 502, 'upstream_error');
  }
  try {
   return await response.json();
  } catch (error) {
   if (method === 'GET') throw error;
   throw fail('Asana returned an unreadable response. Check the task in Asana before trying again.', 502, 'write_unconfirmed');
  }
 }

 function taskEndpoint(id) {
  if (typeof id !== 'string' || !gid.test(id)) throw fail('Invalid Asana task ID.', 400);
  return 'tasks/' + id;
 }

 function updateTask(auth, id, changes) {
  const validators = {
   name: value => typeof value === 'string' && Boolean(value.trim()) && value.length <= 250,
   notes: value => typeof value === 'string' && value.length <= 15000,
   completed: value => typeof value === 'boolean',
   due_on: value => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)
  };
  if (!changes || Array.isArray(changes) || typeof changes !== 'object' || !Object.keys(changes).length ||
     Object.entries(changes).some(([key, value]) => !Object.hasOwn(validators, key) || !validators[key](value))) {
   throw fail('Enter valid task changes.', 400);
  }
  return request(auth, taskEndpoint(id), {opt_fields:taskFields}, {method:'PUT', data:changes});
 }

 function postComment(auth, id, text, parentComment) {
  if (typeof text !== 'string' || !text.trim() || text.length > 15000) throw fail('Enter a comment of up to 15,000 characters.', 400);
  if (parentComment !== undefined && (typeof parentComment !== 'string' || !gid.test(parentComment))) {
   throw fail('Invalid parent comment ID.', 400);
  }
  const data = parentComment === undefined ? {text} : {text,parent_comment:parentComment};
  return request(auth, taskEndpoint(id)+'/stories', {opt_fields:storyFields}, {method:'POST', data});
 }

 return {request, updateTask, postComment, retryAfterMs: () => Math.max(0, retryUntil-Date.now())};
}
