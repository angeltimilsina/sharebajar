import {request} from './platform.js';
import {researchHeaders} from './ai.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=value=>value?new Date(value*1000).toLocaleString():'Not available';

export async function renderAdmin(root){
 root.innerHTML=`<div class="page-heading"><div><div class="eyebrow">ADMINISTRATION</div><h1>User management</h1><p>Review account access and membership. Credentials and sign-in tokens are never shown.</p></div></div><form id="admin-search" class="admin-search"><label>Find account<input name="q" type="search" maxlength="100" placeholder="Search by email"></label><button class="primary" type="submit">Search</button></form><p id="admin-status" role="status" aria-live="polite">Loading accounts…</p><section class="box"><div id="admin-users"></div></section>`;
 const status=root.querySelector('#admin-status'),results=root.querySelector('#admin-users');
 const load=async query=>{
  status.textContent='Loading accounts…';
  try{
   const data=await request('admin/users?q='+encodeURIComponent(query),{headers:researchHeaders()});
   results.innerHTML=`<p class="muted small">${data.total} account(s) · showing ${data.users.length}</p><div class="table-wrap"><table><thead><tr><th>EMAIL</th><th>SIGN-IN</th><th>PLAN</th><th>STATUS</th><th>CREATED</th><th>LAST SEEN</th><th>MANAGE</th></tr></thead><tbody>${data.users.map(user=>`<tr data-user-id="${esc(user.id)}"><td>${esc(user.email)}${user.role==='admin'?'<small>Administrator</small>':''}</td><td>${esc(user.auth_provider.split(',').join(' + '))}</td><td><select data-plan aria-label="Plan for ${esc(user.email)}">${['free','plus','pro'].map(plan=>`<option value="${plan}" ${plan===user.plan?'selected':''}>${plan.toUpperCase()}</option>`).join('')}</select><small>Until ${date(user.plan_expires)}</small></td><td>${user.disabled?'Disabled':'Active'}</td><td>${date(user.created_at)}</td><td>${date(user.last_seen_at)}</td><td><div class="admin-actions"><input data-days type="number" min="1" max="366" value="30" aria-label="Membership days for ${esc(user.email)}"><button type="button" data-action="plan">Save plan</button><button type="button" data-action="status" data-disabled="${!user.disabled}">${user.disabled?'Enable':'Disable'}</button></div></td></tr>`).join('')}</tbody></table></div>`;
   status.textContent='';
  }catch(error){results.replaceChildren();status.textContent='Could not load user accounts: '+error.message;status.setAttribute('role','alert')}
 };
 root.querySelector('#admin-search').addEventListener('submit',event=>{event.preventDefault();load(new FormData(event.currentTarget).get('q').toString().trim())});
 results.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');
  if(!button)return;
  const row=button.closest('tr'),userId=row.dataset.userId;
  const body=button.dataset.action==='plan'
   ?{userId,action:'plan',plan:row.querySelector('[data-plan]').value,days:Number(row.querySelector('[data-days]').value)}
   :{userId,action:'status',disabled:button.dataset.disabled==='true'};
  button.disabled=true;status.removeAttribute('role');status.textContent='Saving account changes…';
  try{await request('admin/users/manage',{method:'POST',headers:{...researchHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body)});await load(root.querySelector('#admin-search [name="q"]').value.trim())}
  catch(error){status.textContent='Could not save account changes: '+error.message;status.setAttribute('role','alert');button.disabled=false}
 });
 await load('');
}
