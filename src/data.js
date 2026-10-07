export const CATEGORIES = [
  {id:'power',name:'动力系统异常',short:'动力系统',desc:'动力输出与驱动系统运行监测',icon:'bolt',tone:'red',level:'高风险'},
  {id:'temperature',name:'电池温度异常',short:'电池温度',desc:'电池热管理与温度阈值监测',icon:'temp',tone:'red',level:'高风险'},
  {id:'brake',name:'制动系统异常',short:'制动系统',desc:'制动响应与压力状态监测',icon:'brake',tone:'amber',level:'中风险'},
  {id:'tire',name:'胎压状态异常',short:'胎压状态',desc:'轮胎压力与状态一致性监测',icon:'tire',tone:'amber',level:'中风险'},
  {id:'connection',name:'设备通信异常',short:'设备通信',desc:'车载设备连接与数据链路监测',icon:'signal',tone:'blue',level:'低风险'},
  {id:'energy',name:'能耗偏高异常',short:'能耗效率',desc:'车辆能耗与运行效率监测',icon:'battery',tone:'blue',level:'低风险'},
];
export let MEMBERS=[];
export const setMembers=users=>{MEMBERS=users.filter(u=>u.active&&u.role!=='viewer').map(u=>u.name);};
export const STEP_NAMES=['问题发现','原因分析','处理执行','结果确认'];
export const statusOf=d=>d.step===4?'已完成':d.step===0?'待处理':'处理中';
export const categoryOf=d=>({...CATEGORIES.find(c=>c.id===d.category),metric:d.metric||'监测指标',value:d.observedValue??'—',resolved:d.resolvedValue??'—',unit:d.unit||'',range:d.normalRange||'未记录',cause:d.cause||'等待分析原因',diagnosis:d.diagnosis||'尚未完成诊断',solution:d.solution||'完成原因分析后制定处理方案'});
