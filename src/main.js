import { icon } from './icons.js';
import { api, setCsrf } from './api.js';
import { CATEGORIES, MEMBERS, setMembers, STEP_NAMES, statusOf, categoryOf } from './data.js';
const app = document.getElementById('app');
let model = {user:null,workspace:{},members:[],vehicles:[],incidents:[],settings:{notifications:true,compact:false},read:[]};
let authStatus, clockOffset=0, routeTicket=0, toastTimer, lastFocus, busy=false, importState;
const state={view:'overview',selected:null,loading:false,modal:null,step:0,period:0,cardStatus:'全部',category:'全部',status:'全部',risk:'全部',owner:'全部',query:'',page:1,pageSize:8,sort:'newest',selectedRows:new Set(),detailTab:'overview',vehicleQuery:'',settingsTab:'preferences',chartDay:null,dayFilter:null,refreshing:false,returnView:'overview',sidebar:false,connection:'连接中'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=(at,kind='full')=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',...(kind==='time'?{hour:'2-digit',minute:'2-digit'}:kind==='day'?{month:'2-digit',day:'2-digit'}:{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}).format(new Date(at)).replaceAll('/','-');
const dayKey=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const now=()=>Date.now()+clockOffset;
const writer=()=>model.user?.role!=='viewer';
const roleName=role=>({admin:'管理员',operator:'处理人员',viewer:'只读人员'})[role]||'成员';
const toneOf=d=>({'高风险':'red','中风险':'amber','低风险':'blue'})[d.level];
const statusTone=d=>d.step===4?'green':d.step===0?'amber':'teal';
const selected=()=>model.incidents.find(d=>d.id===state.selected);
const badge=d=>`<span class="status-badge ${statusTone(d)}"><i></i>${statusOf(d)}</span>`;
const riskBadge=d=>`<span class="risk-badge ${toneOf(d)}"><i></i>${esc(d.level)}</span>`;
const avatar=(name,cls='')=>`<span class="avatar ${cls}">${esc(name?.slice(0,1)||'—')}</span>`;
const btn=(text,action,i,cls='')=>`<button type="button" class="button ${cls}" data-action="${action}">${i?icon(i):''}${text}</button>`;
const option=(values,current)=>values.map(v=>`<option value="${esc(v)}"${v===current?' selected':''}>${esc(v)}</option>`).join('');
const isOverdue=d=>d.step!==4&&d.dueAt<now();
function scoped(){const start=now()-state.period*86400000;return model.incidents.filter(d=>state.period===0|| (state.period===1?dayKey(d.createdAt)===dayKey(now()):d.createdAt>start));}
function counts(items=scoped()){return {total:items.length,pending:items.filter(d=>d.step===0).length,processing:items.filter(d=>d.step>0&&d.step<4).length,done:items.filter(d=>d.step===4).length};}
function toast(message,type='success'){clearTimeout(toastTimer);const el=document.getElementById('toast');if(!el)return;el.innerHTML=`${icon(type==='success'?'check':'alert')}<span>${esc(message)}</span>`;el.className=`toast visible ${type}`;toastTimer=setTimeout(()=>el.classList.remove('visible'),5000);}

function navigate(view,id=''){
  const path=id?`/incident/${encodeURIComponent(id)}`:`/${view}`;
  if(location.hash===`#${path}`)route();else location.hash=path;
}

function render(){
  const active=document.activeElement;
  const focused=active?.id,selection=active?.selectionStart;
  const c=counts(model.incidents);
  const title=state.selected?'异常详情':({overview:'异常概览',records:'异常事件',vehicles:'车辆档案',reports:'运营分析',settings:'设置中心'})[state.view];
  app.innerHTML=`
  <aside class="sidebar ${state.sidebar?'open':''}">
    <a class="brand" href="#/overview" aria-label="FleetOps 首页"><span class="brand-mark">${icon('route')}</span><span>Fleet<span>Ops</span><small>车队异常运营平台</small></span></a>
    <div class="workspace"><span class="workspace-logo">F</span><div>${esc(model.workspace.name)}<small>企业工作空间</small></div><span class="workspace-indicator"></span></div>
    <div class="nav-caption">运营工作台</div>
    <nav aria-label="主导航">
      ${nav('overview','grid','异常概览')}
      ${nav('records','alert','异常事件',c.pending+c.processing)}
      ${nav('vehicles','car','车辆档案')}
      ${nav('reports','chart','运营分析')}
    </nav>
    <div class="sidebar-insight"><span>${icon('shield')}闭环运营</span><p>让风险及时发现，<br>让处理有迹可循。</p><div class="sidebar-line"><i style="width:${Math.round(c.done/Math.max(1,c.total)*100)}%"></i></div><small>${c.done} 项异常已完成闭环</small></div>
    <div class="sidebar-bottom"><button class="nav-item ${state.view==='settings'?'active':''}" data-view="settings">${icon('settings')}<span>设置中心</span></button><button class="nav-item" data-action="guide">${icon('help')}<span>帮助与使用指南</span></button><div class="profile">${avatar(model.user.name)}<div>${esc(model.user.name)}<small>${roleName(model.user.role)}</small></div><button class="icon-button" data-action="profile" aria-label="账号信息">${icon('more')}</button></div></div>
  </aside>
  <div class="mobile-scrim ${state.sidebar?'open':''}" data-action="close-sidebar"></div>
  <div class="main-shell ${model.settings.compact?'compact':''}"><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button><span>工作空间</span>${icon('chevron')}<button data-view="${state.selected?'records':state.view}">${state.selected?'异常事件':title}</button>${state.selected?`${icon('chevron')}<strong>事件详情</strong>`:''}</div><div class="top-actions"><span class="environment-pill"><i></i>${roleName(model.user.role)}</span><button class="global-search" data-action="search-dialog">${icon('search')}搜索事件或车辆 <kbd>⌘ K</kbd></button><span class="divider"></span><button class="icon-button notification-button" data-action="notifications" aria-label="消息通知">${icon('bell')}${unreadNotifications().length&&model.settings.notifications?'<i></i>':''}</button><button class="profile-button" data-action="profile" aria-label="账号信息">${avatar(model.user.name,'small')}</button></div></header>
  <main id="content">${state.selected?detail():({overview,records,vehicles,reports,settings})[state.view]()}</main>
  <footer class="footer"><span><i class="dot green"></i>服务器数据 <span class="footer-divider"></span>${esc(state.connection)}</span><span>FleetOps <span class="footer-divider"></span> Enterprise 3.0</span></footer></div>
  <div id="overlay">${modal()}</div><div id="toast" class="toast" role="status" aria-live="polite"></div>`;
  app.querySelectorAll('button:not([type])').forEach(button=>button.type='button');
  if(focused&&!state.modal){const next=document.getElementById(focused);if(next){next.focus({preventScroll:true});if(typeof selection==='number'&&next.setSelectionRange)next.setSelectionRange(selection,selection);}}
  if(state.modal)queueMicrotask(()=>document.querySelector('.modal input:not([type="checkbox"]), .modal textarea, .modal .close-modal')?.focus({preventScroll:true}));
}

function nav(view,i,label,count){return `<button class="nav-item ${state.view===view?'active':''}" data-view="${view}" title="${label}">${icon(i)}<span>${label}</span>${count?`<b>${count}</b>`:''}</button>`;}

function heading(title,subtitle,actions='',eyebrow='OVERVIEW'){
  return `<div class="page-heading"><div><div class="eyebrow"><span></span>${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function periodSelect(){return `<label class="period-select">${icon('calendar')}<select id="period" aria-label="统计时间范围">${[{n:0,l:'全部时间'},{n:1,l:'今日'},{n:7,l:'近 7 日'},{n:30,l:'近 30 日'}].map(x=>`<option value="${x.n}"${state.period===x.n?' selected':''}>${x.l}</option>`).join('')}</select>${icon('down')}</label>`;}

function stats(){
 const c=counts(),rate=c.total?(c.done/c.total*100).toFixed(1):'0.0';
 return `<div class="stats-grid">
 ${stat('待处理',c.pending,'amber','alert','等待受理与分派',`${scoped().filter(d=>d.step===0&&d.level==='高风险').length} 项高风险`,0,'待处理')}
 ${stat('处理中',c.processing,'teal','pulse','分析、执行与验证',`${scoped().filter(d=>d.step>0&&d.step<4&&isOverdue(d)).length} 项需关注 SLA`,1,'处理中')}
 ${stat('已完成',c.done,'green','shield','处理结果已确认','已闭环归档',2,'已完成')}
 <div class="stat-card"><div class="stat-top"><span>闭环完成率</span><span class="stat-icon blue">${icon('chart')}</span></div><div class="stat-value">${rate}<small>%</small></div><div class="stat-footer"><span>已完成 / 当前范围全部事件</span><b>${c.done} / ${c.total}</b></div></div>
 </div>`;
}

function stat(label,n,tone,i,desc,meta,index,status){return `<button class="stat-card" data-status-link="${status}"><div class="stat-top"><span>${label}<small>异常事件</small></span><span class="stat-icon ${tone}">${icon(i)}</span></div><div class="stat-value">${n}<small>项</small></div><div class="stat-footer"><span>${desc}</span><b class="${tone}">${meta} ${icon('chevron')}</b></div></button>`;}

function overview(){
 const c=counts();const high=scoped().filter(d=>d.level==='高风险'&&d.step===0);
 return heading('异常概览','每一个异常，都有清晰的解决路径。',`<span class="last-updated">${state.refreshing?'<i class="sync-dot"></i>正在同步':`<i class="dot ${state.connection==='已同步'?'green':'amber'}"></i>${esc(state.connection==='已同步'?'服务器数据已同步':state.connection)}`}</span>${writer()?btn('新增异常','incident-new','plus','primary'):''}${writer()?btn('导入','import','file'):''}${btn('刷新','refresh','refresh',state.refreshing?'refreshing':'')}${periodSelect()}`)
 +stats()+`<div class="attention-bar"><span class="attention-symbol">${icon('bolt')}</span><div><b>先关注重要的事</b><span>当前有 <strong>${high.length}</strong> 项高风险事件等待受理${high.length?'，建议优先安排诊断。':'，风险处置持续推进中。'}</span></div><button data-action="high-risk">查看优先队列 ${icon('arrow')}</button></div>
 <section class="category-section"><div class="section-heading"><div><h2>异常分类 <span class="number-chip">06</span></h2><p>按系统定位风险，快速进入处理流程</p></div><div class="risk-legend"><span><i class="dot red"></i>高风险</span><span><i class="dot amber"></i>中风险</span><span><i class="dot blue"></i>低风险</span></div></div>
 <div class="category-toolbar"><div class="segmented" role="tablist" aria-label="异常卡片状态">${['全部','待处理','处理中','已完成'].map((s,i)=>`<button role="tab" aria-selected="${state.cardStatus===s}" data-card-status="${s}" class="${state.cardStatus===s?'active':''}">${s}<span>${[c.total,c.pending,c.processing,c.done][i]}</span></button>`).join('')}</div><label class="search-field">${icon('search')}<input id="category-search" value="${esc(state.query)}" placeholder="搜索异常类型或车辆编号" aria-label="搜索异常类型或车辆编号"><kbd>/</kbd></label></div>
 <div class="cards-grid" id="category-cards">${categoryCards()}</div></section>
 <div class="overview-bottom"><section class="panel recent-panel"><div class="panel-heading"><div><h2>最近活动</h2><p>每一次处理，都会留下记录</p></div><button class="text-button" data-view="records">全部事件 ${icon('arrow')}</button></div>${recentActivity()}</section><section class="panel efficiency-panel"><div class="panel-heading"><h2>处理进度分布</h2><span class="micro-label">当前范围</span></div><div class="efficiency-content"><div class="mini-donut" style="--completed:${c.done/c.total*100||0}%"><div><strong>${c.total}</strong><small>事件总数</small></div></div><div class="efficiency-legend">${[['待处理',c.pending,'amber'],['处理中',c.processing,'teal'],['已完成',c.done,'green']].map(([s,n,t])=>`<button data-status-link="${s}"><i class="dot ${t}"></i><span>${s}</span><strong>${n}</strong><small>${c.total?Math.round(n/c.total*100):0}%</small></button>`).join('')}</div></div><div class="panel-tip">${icon('shield')}数据与异常事件列表实时保持一致</div></section></div>`;
}

function categoryCards(){
 const q=state.query.trim().toLowerCase();
 const cats=CATEGORIES.filter(c=>c.name.includes(q)||scoped().some(d=>d.category===c.id&&d.vehicle.toLowerCase().includes(q)));
 if(!cats.length)return empty('没有找到匹配的异常','试试其他异常名称或 车辆编号。','clear-query');
 return cats.map(cat=>{
  const items=scoped().filter(d=>d.category===cat.id),c=counts(items);
  const visible=state.cardStatus==='全部'?items:items.filter(d=>statusOf(d)===state.cardStatus);
  const representative=(q?visible.find(d=>d.vehicle.toLowerCase().includes(q)):null)||visible.find(d=>d.id===cat.id)||visible[0];
  return `<article class="anomaly-card ${cat.tone}" ${representative?`data-card-detail="${representative.id}"`:""}><div class="card-top"><span class="category-icon ${cat.tone}">${icon(cat.icon)}</span><span class="category-risk"><i class="dot ${cat.tone}"></i>${visible.length?['高风险','中风险','低风险'].find(level=>visible.some(d=>d.level===level)):'暂无事件'}</span><span class="card-sequence">0${CATEGORIES.indexOf(cat)+1}</span></div>
  <button class="card-title" ${representative?`data-detail="${representative.id}"`:'disabled'}><h3>${cat.name}</h3>${icon('arrow')}</button><p>${cat.desc}</p>
  <div class="card-number"><strong>${visible.length}</strong><span>${state.cardStatus==='全部'?'项异常事件':`项${state.cardStatus}`}</span><button class="card-all" data-category-link="${cat.id}">查看列表 ${icon('chevron')}</button></div>
  <div class="stack-bar" aria-label="待处理 ${c.pending}，处理中 ${c.processing}，已完成 ${c.done}">${[['pending',c.pending],['processing',c.processing],['done',c.done]].map(([k,n])=>`<i class="${k}" style="flex:${n||.01}"></i>`).join('')}</div>
  <div class="card-status">${[['待处理',c.pending,'amber'],['处理中',c.processing,'teal'],['已完成',c.done,'green']].map(([s,n,t])=>`<button data-category-link="${cat.id}" data-status="${s}"><i class="dot ${t}"></i>${s}<b>${n}</b></button>`).join('')}</div></article>`;
 }).join('');
}

function recentActivity(){
 const events=scoped().map(d=>({d,event:d.history.at(-1)})).sort((a,b)=>b.event.at-a.event.at).slice(0,3);
 return `<div class="activity-list">${events.map(({d,event})=>`<button class="activity-row" data-detail="${d.id}"><span class="activity-icon ${statusTone(d)}">${icon(d.step===4?'check':'pulse')}</span><div><h3>${esc(d.vehicle)} · ${esc(event.title)}</h3><p>${categoryOf(d).short} <i></i>${esc(event.actor)}</p></div>${badge(d)}<time>${date(event.at,'time')}</time></button>`).join('')}</div>`;
}

function empty(title,desc,action='clear-filters'){return `<div class="empty-state"><span>${icon('search')}</span><h3>${title}</h3><p>${desc}</p>${action?btn(action==='vehicle-new'?'添加车辆':action==='retry-detail'?'重新加载':'重置筛选',action,'refresh'):''}</div>`;}

function filteredIncidents(){
 let list=scoped().filter(d=>
 (state.category==='全部'||d.category===state.category)&&(state.status==='全部'||statusOf(d)===state.status)&&
 (state.risk==='全部'||d.level===state.risk)&&(state.owner==='全部'||(state.owner==='未分派'?!d.owner:d.owner===state.owner))&&
 (!state.dayFilter||dayKey(d.createdAt)===state.dayFilter)&&
 [d.code,d.vehicle,categoryOf(d).name,d.owner,d.group].some(s=>s.toLowerCase().includes(state.query.toLowerCase().trim())));
 const sort={newest:(a,b)=>b.createdAt-a.createdAt,oldest:(a,b)=>a.createdAt-b.createdAt,risk:(a,b)=>['高风险','中风险','低风险'].indexOf(a.level)-['高风险','中风险','低风险'].indexOf(b.level),updated:(a,b)=>b.updatedAt-a.updatedAt};
 return list.sort(sort[state.sort]);
}

function records(){
 const list=filteredIncidents(),c=counts(scoped()),pages=Math.max(1,Math.ceil(list.length/state.pageSize));
 state.page=Math.min(state.page,pages);
 const rows=list.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
 return heading('异常事件','从发现、分派到闭环，管理每一条异常的完整生命周期。',`${writer()?btn('新增异常','incident-new','plus','primary'):''}${periodSelect()}${btn('导出记录','export','download')}`,'INCIDENT MANAGEMENT')
 +`<section class="panel records-panel"><div class="records-tabs" role="tablist" aria-label="事件状态">${['全部','待处理','处理中','已完成'].map((s,i)=>`<button role="tab" aria-selected="${state.status===s}" class="${state.status===s?'active':''}" data-record-status="${s}">${s==='全部'?'全部事件':s}<span>${[c.total,c.pending,c.processing,c.done][i]}</span></button>`).join('')}<span class="records-summary">${icon('shield')}同一事件 · 完整闭环</span></div>
 <div class="records-filters"><label class="search-field">${icon('search')}<input id="records-search" value="${esc(state.query)}" placeholder="搜索事件、车辆、负责人" aria-label="搜索事件、车辆、负责人"></label>
 <label class="filter-select"><span>分类</span><select id="record-category" aria-label="异常分类"><option value="全部">全部分类</option>${CATEGORIES.map(c=>`<option value="${c.id}"${state.category===c.id?' selected':''}>${c.short}</option>`).join('')}</select></label>
 <label class="filter-select"><span>风险</span><select id="record-risk" aria-label="风险等级">${option(['全部','高风险','中风险','低风险'],state.risk)}</select></label>
 <label class="filter-select"><span>负责人</span><select id="record-owner" aria-label="负责人筛选">${option(['全部','未分派',...MEMBERS],state.owner)}</select></label>
 <button class="icon-button filter-reset" data-action="clear-filters" aria-label="重置全部筛选" title="重置全部筛选">${icon('refresh')}</button></div>
 ${state.dayFilter?`<div class="active-filter">发现日期：${state.dayFilter}<button data-action="clear-day" aria-label="清除日期筛选">${icon('close')}</button></div>`:''}
 <div class="table-toolbar"><span>共 <b>${list.length}</b> 条事件 ${state.selectedRows.size?`<span class="selection-count">已选择 ${state.selectedRows.size} 项</span>`:''}</span><label>排序 <select id="sort" aria-label="事件排序">${[{v:'newest',l:'最新发现'},{v:'oldest',l:'最早发现'},{v:'risk',l:'风险优先'},{v:'updated',l:'最近更新'}].map(x=>`<option value="${x.v}"${state.sort===x.v?' selected':''}>${x.l}</option>`).join('')}</select></label></div>
 ${state.selectedRows.size?`<div class="bulk-toolbar"><span>${icon('check')}已选 ${state.selectedRows.size} 条事件</span>${btn('导出所选','export-selected','download')}<button class="text-button" data-action="clear-selection">取消选择</button></div>`:''}
 <div class="table-scroll"><table class="incident-table"><thead><tr><th class="checkbox-cell"><input type="checkbox" id="select-page" aria-label="选择本页全部事件" ${rows.length&&rows.every(d=>state.selectedRows.has(d.id))?'checked':''}></th><th>异常事件 / 车辆</th><th>风险等级</th><th>处理状态</th><th>负责人</th><th>发现时间</th><th>响应时限</th><th class="action-cell">操作</th></tr></thead><tbody>${rows.map(d=>`<tr class="${state.selectedRows.has(d.id)?'selected':''}"><td class="checkbox-cell"><input type="checkbox" data-row="${d.id}" aria-label="选择 ${d.code}"${state.selectedRows.has(d.id)?' checked':''}></td><td><button class="table-event" data-detail="${d.id}"><span class="table-category-icon ${categoryOf(d).tone}">${icon(categoryOf(d).icon)}</span><span><b>${categoryOf(d).name}</b><small>${d.code} <i></i>${esc(d.vehicle)}</small></span></button></td><td>${riskBadge(d)}</td><td>${badge(d)}</td><td>${d.owner?`<span class="owner-cell">${avatar(d.owner,'tiny')}${esc(d.owner)}</span>`:`<span class="unassigned">待分派</span>`}</td><td class="date-cell">${date(d.createdAt).split(' ')[0]}<small>${date(d.createdAt,'time')}</small></td><td>${sla(d)}</td><td class="action-cell"><button class="text-button" data-detail="${d.id}">详情 ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>
 ${!rows.length?empty('没有符合条件的事件','调整搜索词或筛选条件后再试。'):''}
 <div class="pagination"><span>${list.length?`${(state.page-1)*state.pageSize+1}–${Math.min(state.page*state.pageSize,list.length)}`:'0'} / 共 ${list.length} 条</span><div><label>每页 <select id="page-size" aria-label="每页条数">${[8,15,30].map(n=>`<option${state.pageSize===n?' selected':''}>${n}</option>`).join('')}</select> 条</label><button class="page-arrow" data-action="prev-page" aria-label="上一页"${state.page===1?' disabled':''}>${icon('back')}</button>${Array.from({length:pages},(_,i)=>`<button class="page-button ${state.page===i+1?'active':''}" data-page="${i+1}">${i+1}</button>`).join('')}<button class="page-arrow" data-action="next-page" aria-label="下一页"${state.page===pages?' disabled':''}>${icon('arrow')}</button></div></div></section>`;
}

function detail(){
 if(state.loading)return `<div class="detail-loading"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-subtitle"></div><div class="skeleton skeleton-meta"></div><div class="loading-grid"><div class="skeleton"></div><div class="skeleton"></div></div><span>${icon('refresh','spin')}正在加载事件与诊断快照…</span></div>`;
 if(state.detailError)return empty('暂时无法加载事件',esc(state.detailError),'retry-detail');
 const d=selected();if(!d)return `<div class="not-found">${empty('这条事件暂不可用','事件编号不存在，返回事件列表继续查看。','go-records')}</div>`;
 const c=categoryOf(d);
 return `<button class="back-link" data-action="back-list">${icon('back')}返回${state.returnView==='overview'?'异常概览':'事件列表'}</button>
 ${heading(c.name,`<span class="incident-id">${d.code}</span><button class="inline-copy" data-action="copy-id" aria-label="复制事件编号">${icon('copy')}</button><span class="text-divider"></span>${date(d.createdAt)} 发现`,`${badge(d)}${btn('导出记录','export','download')}${d.step===4?btn('查看处理报告','report','file','primary'):!canProcess(d)?'':btn(['受理并分析','确认原因','提交处理结果','确认并归档'][d.step],'advance',d.step===3?'shield':'arrow','primary')}`,'INCIDENT DETAIL')}
 <div class="detail-meta"><div><span class="meta-icon">${icon('car')}</span><span><small>异常车辆</small><button data-vehicle="${d.id}">${esc(d.vehicle)}${icon('external')}</button></span></div><div><span class="meta-icon ${toneOf(d)}">${icon('alert')}</span><span><small>风险等级</small>${riskBadge(d)}</span></div><div><span class="meta-icon">${icon('user')}</span><span><small>处理负责人</small><button data-assign="${d.id}">${d.owner?`${avatar(d.owner,'tiny')}${esc(d.owner)}`:'待分派'}${icon('edit')}</button></span></div><div><span class="meta-icon">${icon('clock')}</span><span><small>响应时限</small>${sla(d)}</span></div></div>
 <div class="detail-tabs" role="tablist" aria-label="事件详情内容">${[{v:'overview',l:'诊断与流程',i:'pulse'},{v:'history',l:'处理记录',i:'file'},{v:'vehicle',l:'关联车辆',i:'car'}].map(t=>`<button role="tab" aria-selected="${state.detailTab===t.v}" class="${state.detailTab===t.v?'active':''}" data-detail-tab="${t.v}">${icon(t.i)}${t.l}${t.v==='history'?`<span>${d.history.length+d.comments.length}</span>`:''}</button>`).join('')}<span>最近更新 ${date(d.updatedAt,'time')} <i class="dot green"></i></span></div>
 ${state.detailTab==='overview'?detailOverview(d,c):state.detailTab==='history'?historyView(d):vehicleDetail(d)}
 `;
}

function flowNode(d,i){
 const done=d.step>i,current=d.step===i;
 return `<button class="flow-node ${done?'done':current?'current':'waiting'}" data-step="${i}"><div class="flow-node-top"><span class="node-step">STEP 0${i+1}</span><span class="node-state">${done?'已完成':current?(i===0?'待受理':'处理中'):'待进行'}</span></div><div class="flow-node-title"><span class="node-icon">${icon(done?'check':['search','chart','settings','shield'][i])}</span><h3>${STEP_NAMES[i]}</h3>${icon('chevron')}</div><p>${['监测识别与事件受理','分析数据与确认原因','实施方案与记录结果','验证恢复与闭环归档'][i]}</p></button>`;
}

function timeline(d,limit){
 const entries=[...d.history,...d.comments].sort((a,b)=>b.at-a.at);
 return `<div class="timeline">${entries.slice(0,limit||entries.length).map((e,i)=>`<div class="timeline-item ${i===0?'latest':''}"><div class="timeline-time"><b>${date(e.at,'time')}</b><small>${date(e.at,'day')}</small></div><span class="timeline-dot"></span><div class="timeline-content"><h3>${esc(e.title)}${i===0?'<span class="latest-tag">最新</span>':''}</h3><p>${esc(e.text)}</p><span>${esc(e.actor)} <i></i>${e.kind==='comment'?'协作备注':'操作记录'}</span></div></div>`).join('')}</div>`;
}

function historyView(d){
 return `<div class="history-grid"><section class="panel history-panel"><div class="panel-heading"><div><h2>完整处理记录</h2><p>事件操作与协作备注按时间倒序排列</p></div><span class="micro-label">${d.history.length+d.comments.length} 条记录</span></div>${timeline(d)}</section><section class="panel comment-panel"><div class="panel-heading"><h2>添加协作备注</h2>${avatar(model.user.name,'small')}</div><p>记录补充信息，方便团队成员接续处理。</p><label for="comment-note" class="form-label">备注内容 <span class="required">*</span></label><textarea id="comment-note" rows="6" maxlength="500" placeholder="例如：检查已完成，建议下一班次继续观察采样结果。"></textarea><div class="form-error" id="comment-error" role="alert"></div><div class="comment-limit">最多 500 字</div>${writer()?btn('发布备注','add-comment','message','primary full-width'):''}<div class="comment-tip">${icon('shield')}发布后保留作者和时间，支持追溯</div></section></div>`;
}

function carIllustration(){return `<svg viewBox="0 0 280 145" fill="none" aria-hidden="true"><ellipse cx="142" cy="123" rx="113" ry="9" fill="#dce9e2"/><path d="m52 83 30-39q8-8 22-8h68q14 0 24 11l27 37 11 9v24H39V94Z" fill="#e5efeb" stroke="#91b6a4" stroke-width="1.5"/><path d="m84 48-23 32h142l-26-32Z" fill="#afccbe" stroke="#779e89"/><path d="M135 47v33M52 84l29 11h104l32-10M81 95v20m102-20v20" stroke="#91b6a4"/><rect x="106" y="102" width="60" height="13" rx="3" fill="#fff" stroke="#9bbda9"/><path d="M48 94h23v9H48m152-9h25v9h-25" fill="#fff" stroke="#91b6a4"/><circle cx="68" cy="120" r="10" fill="#456e57"/><circle cx="208" cy="120" r="10" fill="#456e57"/><path d="M40 113h195" stroke="#91b6a4"/></svg>`;}

function dailyStats(){
 return Array.from({length:Math.min(state.period||7,7)},(_,i)=>{
  const at=now()-(Math.min(state.period||7,7)-i-1)*86400000,key=dayKey(at),items=scoped().filter(d=>dayKey(d.createdAt)===key);
  return {key,label:date(at,'day'),total:items.length,done:items.filter(d=>d.step===4).length};
 });
}

function trendChart(){
 const days=dailyStats(),max=Math.max(1,...days.map(d=>d.total));
 const points=days.map((d,i)=>`${35+i*(610/Math.max(1,days.length-1))},${178-d.total/max*135}`).join(' ');
 const donePoints=days.map((d,i)=>`${35+i*(610/Math.max(1,days.length-1))},${178-d.done/max*135}`).join(' ');
 return `<div class="trend-chart"><div class="chart-axis">${[max,Math.round(max*.66),Math.round(max*.33),0].map(n=>`<span>${n}</span>`).join('')}</div><svg viewBox="0 0 680 205" preserveAspectRatio="none" aria-label="按发现日期统计的异常事件数量"><defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#56a48c" stop-opacity=".16"/><stop offset="1" stop-color="#56a48c" stop-opacity="0"/></linearGradient></defs>${[43,88,133,178].map(y=>`<path class="chart-grid-line" d="M35 ${y}H645"/>`).join('')}<polygon points="${points} 645,178 35,178" fill="url(#trend-fill)"/><polyline class="trend-total" points="${points}"/><polyline class="trend-closed" points="${donePoints}"/>${days.map((d,i)=>`<circle cx="${35+i*(610/Math.max(1,days.length-1))}" cy="${178-d.total/max*135}" r="4" fill="#fff" stroke="#368b71" stroke-width="2"/>`).join('')}</svg><div class="chart-labels">${days.map(d=>`<button data-chart-day="${d.key}" class="${state.chartDay===d.key?'active':''}">${d.label}</button>`).join('')}</div></div>`;
}

function reports(){
 const list=scoped(),c=counts(list),daily=dailyStats(),active=daily.find(d=>d.key===state.chartDay)||daily.at(-1);
 const levels=['高风险','中风险','低风险'].map(l=>list.filter(d=>d.level===l).length),total=Math.max(c.total,1);
 return heading('运营分析','从异常分布到处理成效，用统一数据口径评估运营表现。',`${periodSelect()}${btn('导出分析','export-analysis','download')}`,'OPERATIONAL INSIGHTS')
 +stats()+`<div class="analytics-top"><section class="panel trend-panel"><div class="panel-heading"><div><h2>异常发现趋势</h2><p>最近 ${Math.min(state.period||7,7)} 日，按发现日期统计事件与闭环数量</p></div><div class="chart-legend"><span><i class="dot teal"></i>异常事件</span><span><i class="dot sage"></i>其中已完成</span></div></div>${trendChart()}<div class="chart-insight"><span>${active.label} <b>${active.total}</b> 项异常 · <b>${active.done}</b> 项已完成</span><button class="text-button" data-day-link="${active.key}">查看该日事件 ${icon('arrow')}</button></div></section>
 <section class="panel risk-analysis"><div class="panel-heading"><h2>风险等级分布</h2><span class="micro-label">共 ${c.total} 项</span></div><div class="risk-donut" style="background:conic-gradient(#d9877e 0 ${levels[0]/total*100}%,#dfb96e ${levels[0]/total*100}% ${(levels[0]+levels[1])/total*100}%,#86a8bd ${(levels[0]+levels[1])/total*100}% 100%)"><div><strong>${c.total}</strong><span>异常事件</span></div></div><div class="risk-breakdown">${levels.map((n,i)=>`<button data-risk-link="${['高风险','中风险','低风险'][i]}"><i class="dot ${['red','amber','blue'][i]}"></i><span>${['高风险','中风险','低风险'][i]}</span><b>${n}</b><small>${(n/total*100).toFixed(1)}%</small>${icon('chevron')}</button>`).join('')}</div></section></div>
 <div class="analytics-bottom"><section class="panel category-analysis"><div class="panel-heading"><h2>异常类型分布</h2><span class="micro-label">点击查看事件</span></div><div class="distribution-bars">${CATEGORIES.map(cat=>{const n=list.filter(d=>d.category===cat.id).length;return `<button data-category-link="${cat.id}"><span>${cat.short}</span><div><i class="${cat.tone}" style="width:${n/Math.max(1,...CATEGORIES.map(c=>list.filter(d=>d.category===c.id).length))*100}%"></i></div><b>${n}</b></button>`;}).join('')}</div></section><section class="panel team-analysis"><div class="panel-heading"><h2>团队处理概况</h2><span class="micro-label">协作团队</span></div><div class="team-table">${MEMBERS.map(m=>{const owned=list.filter(d=>d.owner===m),done=owned.filter(d=>d.step===4).length;return `<button data-owner-link="${esc(m)}">${avatar(m)}<div><b>${esc(m)}</b><small>事件负责人</small></div><span><strong>${owned.length}</strong>已分派</span><span><strong>${done}</strong>已闭环</span>${icon('chevron')}</button>`;}).join('')}</div></section></div>`;
}

function openIncident(id){
 state.returnView=state.view==='overview'?'overview':'records';state.selectedRows.clear();navigate('records',id);
}

function linkRecords({category='全部',status='全部',risk='全部',owner='全部',day=null}={}){
 state.category=category;state.status=status;state.risk=risk;state.owner=owner;state.dayFilter=day;state.query='';state.page=1;state.selectedRows.clear();navigate('records');
}

function resetFilters(){state.category='全部';state.status='全部';state.risk='全部';state.owner='全部';state.query='';state.dayFilter=null;state.page=1;state.selectedRows.clear();}

function download(content,filename,type='text/plain;charset=utf-8'){
 const url=URL.createObjectURL(new Blob([content],{type}));
 const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('文件已生成并开始下载');
}

function exportIncidents(items){
 const field=s=>{const raw=String(s??'');const text=/^\s*[=+@\-]/.test(raw)?"'"+raw:raw;return `"${text.replaceAll('"','""')}"`;};
 const csv='\ufeff'+['事件编号','异常类型','车辆编号','风险等级','处理状态','负责人','发现时间','最近更新'].map(field).join(',')+'\n'+items.map(d=>[d.code,categoryOf(d).name,d.vehicle,d.level,statusOf(d),d.owner||'未分派',date(d.createdAt),date(d.updatedAt)].map(field).join(',')).join('\n');
 download(csv,`FleetOps-异常事件-${items.length}条.csv`,'text/csv;charset=utf-8');
}
// This file supplies server-backed screens and actions to main.js.
function showAuth(status, error = '') {
  authStatus = status;
  model.user = null;
  const setup = !status.initialized;
  app.innerHTML = `<div class="auth-layout"><section class="auth-intro"><a class="brand" href="#/overview"><span class="brand-mark">${icon('route')}</span><span>Fleet<span>Ops</span><small>车队异常运营平台</small></span></a><div class="auth-story"><div class="eyebrow">CONNECTED OPERATIONS</div><h1>让每一个异常，<br>都有清晰的解决路径。</h1><p>从问题发现到结果确认，连接车辆、人员与处理记录。</p><div class="auth-flow">发现 <span>→</span> 分析 <span>→</span> 执行 <span>→</span> 确认</div></div><small>企业工作空间 · 团队协作 · 全程留痕</small></section><section class="auth-content"><form id="auth-form" class="auth-card"><span class="micro-label">${setup ? 'WORKSPACE SETUP' : 'WELCOME BACK'}</span><h2>${setup ? '创建企业工作空间' : '登录工作空间'}</h2><p>${setup ? '配置首位管理员，开始管理车辆与异常。' : '使用管理员为你创建的账号登录。'}</p>${setup ? field('workspace', '工作空间名称', '', 'text', true) + field('name', '管理员姓名', '', 'text', true) : ''}${field('email', '工作邮箱', '', 'email', true)}${field('password', '密码', '', 'password', true, 'autocomplete="' + (setup ? 'new-password' : 'current-password') + '" minlength="12" maxlength="128"')}${setup ? '<div class="form-hint">密码至少 12 个字符，建议使用独立的长密码。</div>' : ''}${setup && status.needsSetupToken ? field('setupToken', '初始化令牌', '', 'password', true) : ''}<div class="form-error" id="auth-error" role="alert">${esc(error)}</div><button type="submit" class="button primary full-width" ${setup && !status.setupAvailable ? 'disabled' : ''}>${setup ? '创建工作空间' : '登录'} ${icon('arrow')}</button>${setup && !status.setupAvailable ? '<p>服务尚未配置初始化令牌，请按部署说明配置后重启。</p>' : ''}<small class="auth-note">数据保存在企业服务器，登录后可在不同设备接续处理。</small></form></section></div><div id="toast" class="toast" role="status"></div>`;
}
function field(id, label, value = '', type = 'text', required = false, attrs = '') {
  return `<label class="form-label" for="${id}">${label}${required ? ' <span class="required">*</span>' : ''}</label><input class="form-input" aria-label="${esc(label)}" id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}>`;
}
function area(id, label, value = '', required = false, max = 1000) {
  return `<label class="form-label" for="${id}">${label}${required ? ' <span class="required">*</span>' : ''}</label><textarea aria-label="${esc(label)}" id="${id}" name="${id}" rows="3" maxlength="${max}" ${required ? 'required minlength="6"' : ''}>${esc(value)}</textarea>`;
}
function selectField(id, label, items, current = '', required = false) {
  return `<label class="form-label" for="${id}">${label}${required ? ' <span class="required">*</span>' : ''}</label><select class="form-select" aria-label="${esc(label)}" id="${id}" name="${id}" ${required ? 'required' : ''}>${items.map(([value, name]) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
}
async function initialize() {
  app.innerHTML = '<div class="boot-loading"><span class="boot-mark">FleetOps</span><p>正在连接工作空间…</p></div>';
  try {
    authStatus = await api('/auth/status');
    if (!authStatus.initialized) return showAuth(authStatus);
    await sync(); await route();
  } catch (error) {
    if (error.status === 401) showAuth(authStatus || { initialized: true });
    else app.innerHTML = `<div class="boot-loading"><h2>暂时无法连接工作空间</h2><p>${esc(error.message)}</p>${btn('重新连接', 'retry-connect', 'refresh', 'primary')}</div>`;
  }
}
async function sync() {
  const next = await api('/bootstrap'); model = next; setMembers(next.members); setCsrf(next.csrf); clockOffset = next.serverNow - Date.now(); state.connection = '已同步';
}
function canProcess(d) { return model.user?.role === 'admin' || (model.user?.role === 'operator' && (!d.ownerId || d.ownerId === model.user.id)); }
async function route() {
  if (!model.user) return;
  const ticket = ++routeTicket, parts = location.hash.replace(/^#\/?/, '').split('/');
  state.modal = null; state.sidebar = false; state.detailError = '';
  if (parts[0] === 'incident') {
    try { state.selected = decodeURIComponent(parts[1] || ''); } catch { state.selected = 'invalid'; }
    state.view = 'records'; state.detailTab = 'overview'; state.loading = true; render();
    try { const d = await api(`/incidents/${encodeURIComponent(state.selected)}`); if (ticket !== routeTicket) return; replaceIncident(d); }
    catch (error) { if (ticket !== routeTicket) return; state.detailError = error.message; if (error.status === 401) return showAuth({ initialized: true }, error.message); }
    state.loading = false; render();
  } else { state.selected = null; state.loading = false; state.view = ['overview', 'records', 'vehicles', 'reports', 'settings'].includes(parts[0]) ? parts[0] : 'overview'; render(); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function replaceIncident(d) { const index = model.incidents.findIndex(x => x.id === d.id); if (index < 0) model.incidents.unshift(d); else model.incidents[index] = d; }
function openModal(type, id) { if ((['advance', 'vehicle-new', 'incident-new', 'import'].includes(type)) && model.user.role === 'viewer') return toast('当前账号为只读权限。', 'warning'); if (['assign', 'member-new', 'member-edit'].includes(type) && model.user.role !== 'admin') return toast('此操作需要管理员权限。', 'warning'); lastFocus = document.activeElement; state.modal = { type, id, requestKey:crypto.randomUUID(), stage: (model.incidents.find(d => d.id === (id || state.selected)))?.step, version: (model.incidents.find(d => d.id === (id || state.selected)))?.version }; render(); }
function closeModal() { if (busy) return; state.modal = null; render(); }
function getModalIncident() { return model.incidents.find(d => d.id === (state.modal?.id || state.selected)); }
function sla(d) {
  if (d.step === 4) return `<span class="sla closed">${icon('check')}已归档</span>`;
  const minutes = Math.ceil(Math.abs(d.dueAt - now()) / 60000);
  return `<span class="sla ${isOverdue(d) ? 'overdue' : ''}">${icon('clock')}${isOverdue(d) ? '已超时' : '剩余'} ${minutes >= 60 ? Math.floor(minutes / 60) + 'h ' : ''}${minutes % 60}m</span>`;
}
function detailOverview(d, c) {
  return `<div class="incident-description">${icon('file')}<span><b>异常描述</b>${esc(d.description)}</span></div><div class="detail-grid"><section class="panel workflow-panel"><div class="panel-heading"><div><h2>异常处理流程 <span class="micro-label">闭环追踪</span></h2><p>责任明确，步骤有序，结果可追溯</p></div><div class="workflow-progress"><b>${d.step}</b><span>/ 4</span><small>步骤已完成</small></div></div><div class="workflow-legend"><span><i class="dot green"></i>已完成</span><span><i class="dot teal"></i>进行中</span><span><i class="dot gray"></i>待进行</span></div><div class="snake-flow"><svg class="snake-connectors" viewBox="0 0 600 254" preserveAspectRatio="none" aria-hidden="true"><path class="snake-track" d="M150 54H430Q583 54 583 127T430 200H150"/><path class="snake-dash" d="M150 54H430Q583 54 583 127T430 200H150"/><path class="snake-arrow" d="m290 49 6 5-6 5M304 195l-6 5 6 5"/></svg>${[0, 1, 3, 2].map(i => flowNode(d, i)).join('')}</div><div class="workflow-current ${d.step === 4 ? 'complete' : ''}"><span>${icon(d.step === 4 ? 'shield' : 'pulse')}</span><div><b>${d.step === 4 ? '本次异常已闭环' : '当前：' + STEP_NAMES[d.step]}</b><p>${d.step === 4 ? '结果已经人工确认，处理记录已归档。' : ['等待受理并安排负责人。', '请填写分析原因、诊断结果与处理方案。', '按方案执行操作，并记录处理后读数。', '核验实际处理结果后确认归档。'][d.step]}</p></div>${d.step === 4 ? btn('查看报告', 'report', 'file', 'small-button') : canProcess(d) ? btn('继续处理', 'advance', 'arrow', 'small-button') : '<span class="micro-label">由负责人处理</span>'}</div>${d.draft ? '<div class="draft-strip">' + icon('file') + '你的处理草稿已保存，可继续编辑。</div>' : ''}</section><section class="panel diagnosis-panel"><div class="panel-heading"><h2>诊断记录</h2><span class="diagnostic-chip">${icon('user')}人工确认</span></div><div class="metric-reading"><div><span>${esc(c.metric)}</span><span class="metric-alert ${d.step >= 3 ? 'green' : 'red'}">${d.step >= 3 ? '处理后记录' : '发现时记录'}</span></div><strong>${esc(d.step >= 3 ? c.resolved : c.value)}<small>${esc(c.unit)}</small></strong><span class="normal-range">记录的正常区间 <b>${esc(c.range)}</b></span><div class="reading-caption"><span>发现读数 ${esc(c.value)} ${esc(c.unit)}</span><span>处理后 ${esc(d.resolvedValue ?? '未记录')} ${esc(c.unit)}</span></div></div><div class="diagnostic-section"><h3><span>01</span>可能原因</h3><p>${esc(c.cause)}</p></div><div class="diagnostic-section"><h3><span>02</span>诊断结果</h3><p>${esc(c.diagnosis)}</p></div></section></div><div class="detail-lower"><section class="panel timeline-panel"><div class="panel-heading"><div><h2>事件时间线</h2><p>作者与时间由服务器记录</p></div><button class="text-button" data-detail-tab="history">完整记录 ${icon('arrow')}</button></div>${timeline(d, 4)}</section><section class="panel resolution-panel"><div class="panel-heading"><h2>处理方案</h2><span class="micro-label">人工确认</span></div><div class="solution-icon">${icon('settings')}</div><h3>${esc(c.solution)}</h3><div class="solution-checklist"><span>${icon('check')}保留问题发现和诊断记录</span><span>${icon('check')}记录实际执行操作与结果</span><span>${icon('check')}人工核验后完成归档</span></div>${d.step === 4 ? btn('查看已归档报告', 'report', 'file', 'full-width') : canProcess(d) ? btn('记录处理进度', 'advance', 'edit', 'full-width') : ''}</section></div>`;
}
function vehicleDetail(d) {
  const v = model.vehicles.find(v => v.id === d.vehicleId);
  return `<section class="panel vehicle-info-panel"><div class="panel-heading"><h2>${esc(d.vehicle)} · 车辆档案</h2></div><dl><dt>所属运营组</dt><dd>${esc(v?.group || d.group)}</dd><dt>车型</dt><dd>${esc(v?.model || d.model)}</dd><dt>能源类型</dt><dd>${esc(v?.energy || d.energy)}</dd><dt>登记里程</dt><dd>${esc(v?.mileage ?? d.mileage)} km</dd><dt>关联事件</dt><dd>${model.incidents.filter(i => i.vehicleId === d.vehicleId).length} 条</dd></dl></section>`;
}
function vehicles() {
  const items = model.vehicles.filter(v => [v.number, v.group, v.model].some(s => s.toLowerCase().includes(state.vehicleQuery.toLowerCase().trim())));
  const active = model.vehicles.filter(v => model.incidents.some(d => d.vehicleId === v.id && d.step < 4));
  return heading('车辆档案', '统一登记车辆信息，关联完整的异常处理记录。', writer() ? btn('添加车辆', 'vehicle-new', 'plus', 'primary') : '', 'FLEET DIRECTORY') + `<div class="fleet-summary"><div>${icon('car')}<span>登记车辆</span><strong>${model.vehicles.length}</strong></div><div><i class="dot teal"></i><span>存在活跃异常</span><strong>${active.length}</strong></div><span class="fleet-note">${icon('shield')}独立车辆档案 · 关联多条异常</span></div><div class="section-heading vehicle-heading"><h2>全部车辆 <span class="number-chip">${items.length}</span></h2><label class="search-field">${icon('search')}<input id="vehicle-search" value="${esc(state.vehicleQuery)}" placeholder="搜索车辆编号 / 运营组" aria-label="搜索车辆"></label></div><div class="vehicle-grid">${items.map(v => { const incidents = model.incidents.filter(d => d.vehicleId === v.id), open = incidents.filter(d => d.step < 4); return `<article class="panel vehicle-card"><div class="vehicle-card-header"><span class="vehicle-category">${esc(v.model)} · ${esc(v.energy)}</span><span class="status-badge ${open.length ? 'amber' : 'green'}"><i></i>${open.length ? open.length + ' 项活跃异常' : '无活跃异常'}</span></div><div class="vehicle-drawing">${carIllustration()}</div><div class="vehicle-title"><h3>${esc(v.number)}</h3><span>${esc(v.group)}</span></div><div class="vehicle-anomaly"><span>登记里程 ${v.mileage.toLocaleString()} km</span><span>${incidents.length} 条历史异常</span></div><div class="vehicle-card-actions">${writer() ? `<button class="text-button" data-edit-vehicle="${v.id}">编辑档案 ${icon('edit')}</button>` : ''}<button class="text-button" data-vehicle-records="${esc(v.number)}">查看异常 ${icon('arrow')}</button></div></article>`; }).join('') || empty('暂无车辆档案', '添加车辆后，即可登记并跟踪异常。', writer() ? 'vehicle-new' : '')}</div>`;
}
function settings() {
  return heading('设置中心', '管理团队权限、账号安全与个人偏好。', btn('退出登录', 'logout', 'user'), 'WORKSPACE SETTINGS') + `<div class="settings-layout"><aside class="settings-nav">${[['preferences', '个人偏好', 'settings'], ['members', '团队成员', 'user'], ['workspace', '工作空间', 'grid']].map(([v, l, i]) => `<button class="${state.settingsTab === v ? 'active' : ''}" data-settings-tab="${v}">${icon(i)}${l}${icon('chevron')}</button>`).join('')}</aside><section class="panel settings-panel">${state.settingsTab === 'preferences' ? `<div class="panel-heading"><div><h2>个人偏好</h2><p>跟随账号保存在服务器</p></div></div>${[['notifications', '异常消息通知', '关注最新事件和处理动态'], ['compact', '紧凑表格', '在同一屏幕中查看更多记录']].map(([k, title, desc]) => `<div class="setting-row"><div><b>${title}</b><p>${desc}</p></div><button class="toggle ${model.settings[k] ? 'on' : ''}" data-toggle="${k}" aria-label="${title}" aria-pressed="${model.settings[k]}"><i></i></button></div>`).join('')}<div class="setting-row"><div><b>密码安全</b><p>修改后其他设备会话会失效</p></div>${btn('修改密码', 'password', 'shield')}</div>` : state.settingsTab === 'members' ? `<div class="panel-heading"><div><h2>团队成员</h2><p>管理员管理权限，处理人员推进任务，只读人员查看记录</p></div>${model.user.role === 'admin' ? btn('添加成员', 'member-new', 'plus', 'primary') : ''}</div><div class="member-list">${model.members.map(m => `<div>${avatar(m.name)}<span><b>${esc(m.name)}</b><small>${esc(m.email)}</small></span><span class="member-workload">${roleName(m.role)} · ${m.active ? '启用' : '停用'}</span>${model.user.role === 'admin' ? `<button class="text-button" data-member="${m.id}">管理 ${icon('edit')}</button>` : ''}</div>`).join('')}</div>` : `<div class="panel-heading"><h2>工作空间信息</h2><span class="status-badge teal"><i></i>多人协作</span></div><dl class="workspace-details"><dt>空间名称</dt><dd>${esc(model.workspace.name)}</dd><dt>数据规模</dt><dd>${model.vehicles.length} 辆车辆 · ${model.incidents.length} 条事件</dd><dt>保存方式</dt><dd>企业服务器 · SQLite 数据库</dd><dt>协作同步</dt><dd>每 15 秒同步，提交时检查数据版本</dd><dt>权限</dt><dd>${roleName(model.user.role)}</dd></dl>${model.user.role === 'admin' ? `<div class="setting-row"><div><b>导出业务记录</b><p>包含车辆、事件、审计与成员信息；完整备份请使用部署脚本</p></div>${btn('导出 JSON', 'export-workspace', 'download')}</div>` : ''}`}</section></div>`;
}
function modal() {
  if (!state.modal) return '';
  const { type, id } = state.modal, d = getModalIncident();
  let title = '', subtitle = '', body = '', submit = '', label = '保存';
  if (type === 'advance' && d) {
    title = ['受理事件并开始分析', '确认原因与处理方案', '提交处理结果', '确认并归档'][d.step]; subtitle = `${d.code} · ${d.vehicle}`;
    const draft = d.draft?.stage === d.step ? d.draft : {};
    body = `<div class="form-context"><span class="category-icon ${categoryOf(d).tone}">${icon(categoryOf(d).icon)}</span><div><b>${categoryOf(d).name}</b><p>${STEP_NAMES[d.step]}</p></div>${badge(d)}</div>`;
    if (d.step === 0) body += selectField('process-owner', '处理负责人', [['', '请选择负责人'], ...model.members.filter(m => m.active && m.role !== 'viewer' && (model.user.role === 'admin' || m.id === model.user.id)).map(m => [m.id, m.name])], draft.ownerId || d.ownerId || (model.user.role === 'operator' ? model.user.id : ''), true);
    if (d.step === 1) body += area('process-cause', '可能原因', draft.cause || d.cause, true) + area('process-diagnosis', '诊断结果', draft.diagnosis || d.diagnosis, true) + area('process-solution', '处理方案', draft.solution || d.solution, true);
    if (d.step === 2) body += `<div class="process-plan"><span>已确认处理方案</span><p>${esc(d.solution)}</p></div>` + field('process-value', `处理后读数${d.unit ? '（' + esc(d.unit) + '）' : ''}`, draft.resolvedValue ?? '', 'number', d.observedValue != null, 'step="any"');
    if (d.step === 3) body += `<div class="verification-grid"><span>发现时读数<b>${esc(d.observedValue ?? '未记录')} ${esc(d.unit)}</b></span><span>处理后读数<b>${esc(d.resolvedValue ?? '未记录')} ${esc(d.unit)}</b></span></div><label class="verification-check"><input type="checkbox" id="verify-check"><span>已核验实际处理结果，确认本次异常可以归档</span></label>`;
    body += area('process-note', ['受理说明', '分析补充说明', '处理结果说明', '归档说明'][d.step], draft.note || '', true, 500); submit = 'submit-process'; label = d.step === 3 ? '确认并归档' : '提交并继续';
  } else if (type === 'vehicle-new' || type === 'vehicle-edit') {
    const v = model.vehicles.find(v => v.id === id) || {}; title = type === 'vehicle-new' ? '添加车辆档案' : '编辑车辆档案';
    body = field('number', '车辆编号', v.number, 'text', true, 'maxlength="40"') + field('group', '所属运营组', v.group, 'text', true, 'maxlength="60"') + field('model', '车型', v.model, 'text', true, 'maxlength="60"') + selectField('energy', '能源类型', ['纯电', '燃油', '混合动力', '其他'].map(s => [s, s]), v.energy || '纯电') + field('mileage', '登记里程（km）', v.mileage ?? 0, 'number', true, 'min="0" step="any"'); submit = 'save-vehicle';
  } else if (type === 'incident-new') {
    title = '登记异常事件'; subtitle = '先登记问题，随后在详情页完成诊断与处理。';
    body = selectField('vehicleId', '异常车辆', [['', '请选择已登记车辆'], ...model.vehicles.map(v => [v.id, v.number + ' · ' + v.group])], '', true) + (model.vehicles.length ? '' : `<div class="form-hint">还没有车辆档案。<button type="button" class="text-button" data-action="vehicle-new">先添加车辆</button></div>`) + selectField('category', '异常分类', CATEGORIES.map(c => [c.id, c.name]), 'power', true) + selectField('level', '风险等级', ['高风险', '中风险', '低风险'].map(s => [s, s]), '中风险') + field('occurred', '发现时间', new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16), 'datetime-local', true) + area('description', '异常描述', '', true) + '<details class="optional-fields"><summary>补充监测指标（可选）</summary>' + field('metric', '指标名称') + field('observedValue', '发现时读数', '', 'number', false, 'step="any"') + field('unit', '单位') + field('normalRange', '正常区间') + '</details>'; submit = 'create-incident'; label = '创建事件';
  } else if (type === 'member-new') {
    title = '添加团队成员'; body = field('name', '姓名', '', 'text', true) + field('email', '工作邮箱', '', 'email', true) + field('password', '初始密码（至少 12 个字符）', '', 'password', true, 'minlength="12" autocomplete="new-password"') + selectField('role', '权限角色', ['operator', 'viewer', 'admin'].map(r => [r, roleName(r)]), 'operator'); submit = 'save-member'; label = '创建成员';
  } else if (type === 'member-edit') {
    const member = model.members.find(m => m.id === id); title = `管理成员 · ${member.name}`; body = selectField('role', '权限角色', ['admin', 'operator', 'viewer'].map(r => [r, roleName(r)]), member.role) + selectField('active', '账号状态', [['true', '启用'], ['false', '停用']], String(member.active)) + '<p class="form-hint">变更权限将使此成员的现有登录失效；停用前需转移活跃任务。</p>'; submit = 'update-member';
  } else if (type === 'assign' && d) {
    title = '分派负责人'; subtitle = d.code; body = selectField('assign-owner', '负责人', [['', '请选择负责人'], ...model.members.filter(m => m.active && m.role !== 'viewer').map(m => [m.id, m.name])], d.ownerId || '', true); submit = 'confirm-assign'; label = '确认分派';
  } else if (type === 'password') {
    title = '修改密码'; body = field('currentPassword', '当前密码', '', 'password', true, 'autocomplete="current-password"') + field('password', '新密码（至少 12 个字符）', '', 'password', true, 'minlength="12" autocomplete="new-password"'); submit = 'change-password';
  } else if (type === 'report' && d) {
    title = '异常闭环报告'; subtitle = d.code; body = `<div class="report-result">${icon('shield')}<div><h3>本次异常已完成闭环</h3><p>诊断、执行与人工确认记录已归档</p></div>${badge(d)}</div><div class="report-metadata"><span>异常车辆<b>${esc(d.vehicle)}</b></span><span>负责人<b>${esc(d.owner)}</b></span></div>${timeline(d)}`; submit = 'export-report'; label = '下载报告';
  } else if (type === 'step' && d) {
    title = STEP_NAMES[state.step]; const record = d.history.filter(e => e.kind === 'process')[state.step]; body = `<div class="step-explanation"><span class="big-step-icon">${icon(['search', 'chart', 'settings', 'shield'][state.step])}</span><p>${['核对异常信息，安排负责人并开始处理。', '填写可能原因、诊断结果与处理方案。', '按方案执行操作，记录实际结果和读数。', '人工核验处理结果，并确认归档。'][state.step]}</p></div><div class="step-status-line">节点状态<span>${d.step > state.step ? '已完成' : d.step === state.step ? '当前步骤' : '待进行'}</span></div>${record ? `<div class="step-evidence"><b>${esc(record.title)}</b><p>${esc(record.text)}</p><small>${esc(record.actor)} · ${date(record.at)}</small></div>` : ''}`;
  } else if (type === 'import') {
    title = '批量导入异常'; subtitle = 'CSV · 每次最多 200 条 · 全部校验通过后写入';
    body = '<p class="modal-intro">先登记车辆。支持字段：车辆编号、异常分类、风险等级、异常描述、指标名称、发现读数、单位、正常区间、发现时间。异常分类可填写名称或英文标识；发现时间使用带时区的 ISO 格式。</p><button type="button" class="button" data-action="csv-template">下载空白模板</button><label class="form-label" for="csv-file">选择 CSV 文件</label><input id="csv-file" type="file" accept=".csv,text/csv"><div id="import-preview" class="import-preview"></div>'; submit = 'submit-import'; label = '确认导入';
  } else if (type === 'notifications') {
    title = '消息中心'; body = `<div class="notifications-list">${notificationItems().map(({d, event}) => `<button type="button" data-detail="${d.id}"><span class="notification-icon ${statusTone(d)}">${icon('alert')}</span><div><h3>${esc(event.title)}</h3><p>${esc(d.vehicle)} · ${categoryOf(d).name}</p><small>${date(event.at)}</small></div></button>`).join('') || '<p>暂无事件动态</p>'}</div>`;
  } else if (type === 'search') {
    title = '快速查找'; body = `<label class="search-field command-input">${icon('search')}<input id="command-query" placeholder="搜索事件、车辆、负责人" aria-label="快速搜索"></label><div id="command-results">${commandResults('')}</div>`;
  } else if (type === 'profile') {
    title = '账号与工作空间'; body = `<div class="profile-card">${avatar(model.user.name)}<h3>${esc(model.user.name)}</h3><p>${esc(model.user.email)}</p><span class="micro-label">${roleName(model.user.role)} · ${esc(model.workspace.name)}</span></div>`; submit = 'logout'; label = '退出登录';
  } else {
    title = '使用指南'; body = '<div class="guide-list"><div><span>01</span><div><h3>登记车辆与异常</h3><p>先添加车辆档案，再通过页面录入或 CSV 导入异常。</p></div></div><div><span>02</span><div><h3>分析与执行</h3><p>管理员分派任务，负责人沿蛇形四步流程记录原因、诊断和处理结果。</p></div></div><div><span>03</span><div><h3>确认与协作</h3><p>人工核验后归档，状态与数量同步更新。团队通过协作备注接续处理。</p></div></div></div>';
  }
  return `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="icon-button close-modal" data-action="close-modal" aria-label="关闭对话框">${icon('close')}</button></header><form id="product-form" data-submit="${submit}"><div class="modal-body">${body}<div class="form-error" id="form-error" role="alert"></div><div class="modal-safety">${icon('shield')}保存后同步到服务器，保留操作者和时间</div></div><footer class="modal-actions">${type === 'advance' ? btn('保存草稿', 'save-draft', 'file') : ''}<button type="button" class="button" data-action="close-modal">关闭</button>${submit ? `<button type="submit" class="button primary">${label} ${icon('check')}</button>` : ''}</footer></form></section></div>`;
}
function notificationItems() { return model.incidents.map(d => ({d, event: [...d.history, ...d.comments].sort((a,b) => b.at-a.at)[0]})).filter(x => x.event).sort((a,b) => b.event.at-a.event.at).slice(0,10); }
function unreadNotifications() { return model.settings.notifications ? notificationItems().filter(x => !model.read.includes(x.event.id)) : []; }
function commandResults(query) { const q = query.toLowerCase().trim(); return `<div class="command-results">${model.incidents.filter(d => [d.code,d.vehicle,d.owner,categoryOf(d).name].some(s => s.toLowerCase().includes(q))).slice(0,8).map(d => `<button data-detail="${d.id}"><span class="category-icon ${categoryOf(d).tone}">${icon(categoryOf(d).icon)}</span><span><b>${categoryOf(d).name}</b><small>${esc(d.vehicle)} · ${d.code}</small></span>${badge(d)}</button>`).join('') || '<p>未找到匹配事件。</p>'}</div>`; }
function processBody() { const value = id => document.getElementById(id)?.value; return { version: state.modal.version, note: value('process-note'), ownerId: value('process-owner'), cause: value('process-cause'), diagnosis: value('process-diagnosis'), solution: value('process-solution'), resolvedValue: value('process-value') ? Number(value('process-value')) : null, verified: document.getElementById('verify-check')?.checked || false }; }
async function mutate(path, body, method = 'POST', message = '已保存') {
  const result = await api(path, {method, body, headers: method === 'POST' && state.modal?.requestKey ? {'Idempotency-Key':state.modal.requestKey} : {}});
  let synced = true; try { await sync(); } catch (error) { if(error.status===401){showAuth({initialized:true},'设置已保存，请重新登录。');return result;} synced = false; if(result.history) replaceIncident(result); state.connection = '记录已保存，列表待同步'; }
  state.modal = null; render(); toast(synced ? message : '记录已保存；暂时无法同步列表，请点击刷新。', synced ? 'success' : 'warning'); return result;
}
async function submitProduct(action) {
  const d = getModalIncident(), value = id => document.getElementById(id)?.value;
  switch(action) {
    case 'submit-process': await mutate(`/incidents/${d.id}/advance`, processBody(), 'POST', d.step === 3 ? '已完成归档，数量与状态已更新' : '处理进度已保存'); break;
    case 'save-vehicle': { const id = state.modal.id, v = model.vehicles.find(v => v.id === id); await mutate(id ? `/vehicles/${id}` : '/vehicles', {number:value('number'),group:value('group'),model:value('model'),energy:value('energy'),mileage:Number(value('mileage')),version:v?.version}, id ? 'PATCH' : 'POST', '车辆档案已保存'); break; }
    case 'create-incident': { const result = await mutate('/incidents', {vehicleId:value('vehicleId'),category:value('category'),level:value('level'),description:value('description'),createdAt:Date.parse(value('occurred') + '+08:00'),metric:value('metric'),observedValue:value('observedValue') ? Number(value('observedValue')) : null,unit:value('unit'),normalRange:value('normalRange')}, 'POST', '异常事件已创建'); openIncident(result.id); break; }
    case 'save-member': await mutate('/users', {name:value('name'),email:value('email'),password:value('password'),role:value('role')}, 'POST', '成员已创建，请通过企业安全渠道交付初始凭据'); break;
    case 'update-member': await mutate(`/users/${state.modal.id}`, {role:value('role'),active:value('active') === 'true'}, 'PATCH', '成员权限已更新'); break;
    case 'confirm-assign': await mutate('/incidents/assign', {ownerId:value('assign-owner'),items:[{id:d.id,version:state.modal.version}]}, 'POST', '负责人已分派'); break;
    case 'change-password': await mutate('/auth/password', {currentPassword:value('currentPassword'),password:value('password')}, 'POST', '密码已更新，其他设备会话已退出'); break;
    case 'submit-import': if (!importState?.items?.length || importState.errors.length) throw new Error('请先选择文件并通过校验。'); await mutate('/incidents/import', {items:importState.items}, 'POST', '事件已全部导入',); break;
    case 'export-report': exportReport(d); break;
    case 'logout': await logout(); break;
  }
}
async function logout() { await api('/auth/logout', {method:'POST',body:{}}); model.user = null; showAuth({initialized:true}); }
function exportReport(d) { const c = categoryOf(d); download(`FleetOps · 异常处理报告\n事件：${d.code}\n车辆：${d.vehicle}\n状态：${statusOf(d)}\n负责人：${d.owner}\n描述：${d.description}\n可能原因：${c.cause}\n诊断：${c.diagnosis}\n方案：${c.solution}\n发现读数：${c.value} ${c.unit}\n处理后读数：${c.resolved} ${c.unit}\n\n${[...d.history,...d.comments].sort((a,b)=>a.at-b.at).map(e=>`${date(e.at)} | ${e.actor} | ${e.title}\n${e.text}`).join('\n\n')}`, `${d.code}-处理报告.txt`); }
function parseCSV(source) {
  const rows = []; let row = [], cell = '', quoted = false;
  source = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) { const char = source[i]; if (char === '"') { if (quoted && source[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted; } else if (!quoted && char === ',') { row.push(cell); cell = ''; } else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && source[i+1] === '\n') i++; row.push(cell); if (row.some(v=>v.trim())) rows.push(row); row = []; cell = ''; } else cell += char; }
  if (quoted) throw new Error('CSV 引号未闭合。'); row.push(cell); if (row.some(v=>v.trim())) rows.push(row); return rows;
}
async function previewImport(file) {
  importState = null; if (!file) return; if (file.size > 1024*1024) throw new Error('文件不能超过 1 MB。');
  const rows = parseCSV(await file.text()), header = rows.shift() || [], errors = [], items = [];
  if(new Set(header).size!==header.length)errors.push('CSV 表头不能重复。');
  for (const field of ['车辆编号','异常分类','风险等级','异常描述']) if (!header.includes(field)) errors.push(`缺少字段：${field}`);
  if (!rows.length || rows.length > 200) errors.push('文件需包含 1–200 条事件。');
  rows.forEach((row, index) => {
    const get = name => (row[header.indexOf(name)] || '').trim(), category = CATEGORIES.find(c=>c.id === get('异常分类') || c.name === get('异常分类'))?.id;
    const value = get('发现读数'), time = get('发现时间');
    if (!model.vehicles.some(v=>v.number === get('车辆编号'))) errors.push(`第 ${index+1} 行：车辆未登记`);
    if (!category || !['高风险','中风险','低风险'].includes(get('风险等级')) || get('异常描述').length < 6) errors.push(`第 ${index+1} 行：类型、等级或描述无效`);
    if (value && !Number.isFinite(Number(value))) errors.push(`第 ${index+1} 行：发现读数无效`);
    if (time && (!/T.*(Z|[+-]\d\d:\d\d)$/.test(time) || !Number.isFinite(Date.parse(time)))) errors.push(`第 ${index+1} 行：时间需为带时区的 ISO 格式`);
    items.push({vehicleNumber:get('车辆编号'),category,level:get('风险等级'),description:get('异常描述'),metric:get('指标名称'),observedValue:value ? Number(value) : null,unit:get('单位'),normalRange:get('正常区间'),...(time ? {createdAt:Date.parse(time)} : {})});
  });
  importState = {items,errors,key:crypto.randomUUID()};
  document.getElementById('import-preview').innerHTML = `<b>解析 ${items.length} 条事件 · ${errors.length ? errors.length + ' 处需要修正' : '格式校验通过'}</b>${errors.length ? `<ul>${errors.slice(0,12).map(e=>`<li>${esc(e)}</li>`).join('')}</ul>` : items.slice(0,5).map(i=>`<p>${esc(i.vehicleNumber)} · ${categoryOf(i).name} · ${esc(i.description)}</p>`).join('')}<small>服务器将在写入前再次校验；任一条失败均不会导入。</small>`;
}

async function handleError(error, target = 'form-error') {
  if (error.status === 401) { busy = false; showAuth({initialized:true}, error.message); return; }
  if (error.status === 409 && state.selected) {
    try {
      const d = await api(`/incidents/${state.selected}`); replaceIncident(d);
      if(state.modal)state.modal.latest={version:d.version,step:d.step};
    } catch { /* Keep the submitted form if refresh is unavailable. */ }
  }
  const el = document.getElementById(target);
  if (el) { el.textContent = error.message; if(error.status===409 && state.modal?.latest){const button=document.createElement('button');button.type='button';button.className='text-button';button.dataset.action='use-latest';button.textContent=state.modal.latest.step===state.modal.stage?'已核对最新记录，继续编辑':'流程已推进，打开最新步骤';el.append(document.createElement('br'),button);} el.scrollIntoView({block:'nearest'}); }
  else toast(error.message, 'warning');
}
app.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const form = event.target, button = form.querySelector('[type="submit"]');
  busy = true; if (button) { button.disabled = true; button.dataset.label = button.innerHTML; button.innerHTML = `${icon('refresh','spin')}正在保存…`; }
  try {
    if (form.id === 'auth-form') {
      const body = Object.fromEntries(new FormData(form)), setup = !authStatus?.initialized;
      const result = await api(setup ? '/auth/setup' : '/auth/login', {method:'POST',body}); setCsrf(result.csrf); await sync(); await route();
    } else if (form.id === 'product-form') {
      if (form.dataset.submit === 'submit-import') {
        if (!importState?.items?.length || importState.errors.length) throw new Error('请选择文件并修正校验错误。');
        await api('/incidents/import', {method:'POST',body:{items:importState.items},headers:{'Idempotency-Key':importState.key}}); await sync(); state.modal=null; render(); toast('异常已全部导入');
      } else await submitProduct(form.dataset.submit);
    }
  } catch (error) { await handleError(error, form.id === 'auth-form' ? 'auth-error' : 'form-error'); }
  finally { busy = false; if (button.isConnected) { button.disabled = false; button.innerHTML = button.dataset.label; } }
});
app.addEventListener('click', async event => {
  const el=event.target.closest('button,a,[data-action]')||event.target.closest('[data-card-detail]');
  if(!el||el.disabled||el.matches('button[type="submit"]')||busy)return;
  if(el.dataset.detail||el.dataset.cardDetail){openIncident(el.dataset.detail||el.dataset.cardDetail);return;}
  if(el.dataset.view){navigate(el.dataset.view);return;}
  if(el.dataset.statusLink){linkRecords({status:el.dataset.statusLink});return;}
  if(el.dataset.categoryLink){linkRecords({category:el.dataset.categoryLink,status:el.dataset.status||'全部'});return;}
  if(el.dataset.riskLink){linkRecords({risk:el.dataset.riskLink});return;}
  if(el.dataset.ownerLink){linkRecords({owner:el.dataset.ownerLink});return;}
  if(el.dataset.dayLink){linkRecords({day:el.dataset.dayLink});return;}
  if(el.dataset.cardStatus){state.cardStatus=el.dataset.cardStatus;render();return;}
  if(el.dataset.recordStatus){state.status=el.dataset.recordStatus;state.page=1;state.selectedRows.clear();render();return;}
  if(el.dataset.detailTab){state.detailTab=el.dataset.detailTab;render();return;}
  if(el.dataset.settingsTab){state.settingsTab=el.dataset.settingsTab;render();return;}
  if(el.dataset.page){state.page=Number(el.dataset.page);render();return;}
  if(el.dataset.assign){openModal('assign',el.dataset.assign);return;}
  if(el.dataset.vehicle){state.detailTab='vehicle';render();return;}
  if(el.dataset.editVehicle){openModal('vehicle-edit',el.dataset.editVehicle);return;}
  if(el.dataset.vehicleRecords){linkRecords();state.query=el.dataset.vehicleRecords;state.period=0;render();return;}
  if(el.dataset.member){openModal('member-edit',el.dataset.member);return;}
  if(el.dataset.step!==undefined){state.step=Number(el.dataset.step);openModal('step');return;}
  if(el.dataset.chartDay){state.chartDay=el.dataset.chartDay;render();return;}
  const action=el.dataset.action;
  if(action==='backdrop'&&event.target!==el)return;
  try {
    if(el.dataset.toggle){await api('/preferences',{method:'PATCH',body:{[el.dataset.toggle]:!model.settings[el.dataset.toggle]}});await sync();render();toast('个人偏好已保存');return;}
    switch(action){
      case 'retry-connect': await initialize(); break;
      case 'retry-detail': await route(); break;
      case 'use-latest': if(state.modal.latest.step===state.modal.stage){state.modal.version=state.modal.latest.version;document.getElementById('form-error').textContent='已使用最新版本，请核对后提交。';}else{openModal('advance');}break;
      case 'close-modal': case 'backdrop': closeModal(); break;
      case 'vehicle-new': case 'incident-new': case 'member-new': case 'password': case 'import': case 'profile': case 'guide': openModal(action); break;
      case 'notifications': await api('/preferences',{method:'PATCH',body:{readAppend:notificationItems().map(x=>x.event.id)}});await sync();openModal('notifications');break;
      case 'search-dialog': openModal('search'); break;
      case 'advance': if(selected()?.step<4&&canProcess(selected()))openModal('advance');break;
      case 'report': openModal('report');break;
      case 'refresh': state.refreshing=true;render();try{await sync();}finally{state.refreshing=false;render();}toast('服务器记录已同步');break;
      case 'high-risk': linkRecords({status:'待处理',risk:'高风险'});break;
      case 'clear-query': state.query='';render();break;
      case 'clear-filters': resetFilters();render();break;
      case 'clear-day': state.dayFilter=null;state.page=1;render();break;
      case 'clear-vehicle': state.vehicleQuery='';render();break;
      case 'clear-selection': state.selectedRows.clear();render();break;
      case 'prev-page': state.page--;render();break;
      case 'next-page': state.page++;render();break;
      case 'save-draft': await api(`/incidents/${state.selected}/draft`,{method:'PUT',body:processBody()});await sync();state.modal=null;render();toast('你的处理草稿已保存到服务器');break;
      case 'add-comment': { const note=document.getElementById('comment-note').value;await api(`/incidents/${state.selected}/comments`,{method:'POST',body:{note}});await sync();render();toast('协作备注已发布');break; }
      case 'back-list': navigate(state.returnView);break;
      case 'go-records': navigate('records');break;
      case 'go-settings': navigate('settings');break;
      case 'export': exportIncidents(state.selected?[selected()]:state.view==='records'?filteredIncidents():scoped());break;
      case 'export-selected': exportIncidents(model.incidents.filter(d=>state.selectedRows.has(d.id)));break;
      case 'export-workspace': download(JSON.stringify(await api('/export'),null,2),'FleetOps-业务记录.json','application/json');break;
      case 'export-analysis': download('\uFEFF异常分类,待处理,处理中,已完成,总数\n'+CATEGORIES.map(cat=>{const c=counts(scoped().filter(d=>d.category===cat.id));return[cat.name,c.pending,c.processing,c.done,c.total].join(',');}).join('\n'),'FleetOps-运营分析.csv','text/csv;charset=utf-8');break;
      case 'csv-template': download('\uFEFF车辆编号,异常分类,风险等级,异常描述,指标名称,发现读数,单位,正常区间,发现时间\r\n','FleetOps-导入模板.csv','text/csv;charset=utf-8');break;
      case 'copy-id': try{await navigator.clipboard.writeText(selected().code);toast('事件编号已复制');}catch{toast(selected().code,'warning');}break;
      case 'logout': await logout();break;
      case 'menu': state.sidebar=!state.sidebar;render();break;
      case 'close-sidebar': state.sidebar=false;render();break;
    }
  }catch(error){await handleError(error,action==='add-comment'?'comment-error':'form-error');}
});
app.addEventListener('input',event=>{
  const id=event.target.id;
  if(id==='category-search'){state.query=event.target.value;document.getElementById('category-cards').innerHTML=categoryCards();}
  if(id==='records-search'){state.query=event.target.value;state.page=1;state.selectedRows.clear();render();}
  if(id==='vehicle-search'){state.vehicleQuery=event.target.value;render();}
  if(id==='command-query')document.getElementById('command-results').innerHTML=commandResults(event.target.value);
});
app.addEventListener('change',async event=>{
  const el=event.target,id=el.id;
  if(id==='csv-file'){try{await previewImport(el.files[0]);}catch(error){await handleError(error);}return;}
  if(id==='period'){state.period=Number(el.value);state.page=1;state.chartDay=null;state.selectedRows.clear();render();return;}
  const fields={'record-category':'category','record-risk':'risk','record-owner':'owner',sort:'sort'};
  if(fields[id]){state[fields[id]]=el.value;state.page=1;state.selectedRows.clear();render();}
  if(id==='page-size'){state.pageSize=Number(el.value);state.page=1;render();}
  if(el.dataset.row){el.checked?state.selectedRows.add(el.dataset.row):state.selectedRows.delete(el.dataset.row);render();}
  if(id==='select-page'){filteredIncidents().slice((state.page-1)*state.pageSize,state.page*state.pageSize).forEach(d=>el.checked?state.selectedRows.add(d.id):state.selectedRows.delete(d.id));render();}
});
document.addEventListener('keydown',event=>{
  if(!model.user)return;
  if(event.key==='Escape'){if(state.modal)closeModal();else if(state.sidebar){state.sidebar=false;render();}}
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openModal('search');}
  if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)&&!state.modal){const search=document.querySelector('#category-search,#records-search,#vehicle-search');if(search){event.preventDefault();search.focus();}}
  if(event.key==='Tab'&&state.modal){const items=[...document.querySelectorAll('.modal button:not(:disabled),.modal input,.modal select,.modal textarea')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
window.addEventListener('hashchange',route);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&model.user&&!state.modal)poll();});
let polling=false;
async function poll(){
  if(polling||busy||!model.user||state.modal||document.hidden||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
  polling=true;
  try{const result=await api('/revision');if(result.revision!==model.workspace.revision){await sync();render();}else if(state.connection!=='已同步'){state.connection='已同步';render();}}
  catch(error){state.connection='连接中断，请重试';if(error.status===401)showAuth({initialized:true},error.message);else document.querySelector('.footer>span')?.replaceChildren(document.createTextNode(state.connection));}
  finally{polling=false;}
}
setInterval(poll,15000);
initialize();
