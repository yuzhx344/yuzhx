let csrf = '';
export const setCsrf = value => { csrf = value; };
export async function api(path, { method = 'GET', body, headers = {}, ...options } = {}) {
  let response;
  try { response = await fetch(`/api${path}`, { ...options, method, credentials: 'same-origin', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { const error = new Error('无法连接服务器，请检查网络后重试。当前填写内容已保留。'); error.status = 0; throw error; }
  let data;
  try { data = await response.json(); } catch { const error = new Error('服务器响应无效，请稍后重试。'); error.status = response.status === 401 ? 401 : 502; throw error; }
  if (!response.ok) { const error = new Error(data?.error || '请求失败，请稍后重试。'); error.status = response.status; throw error; }
  return data;
}
