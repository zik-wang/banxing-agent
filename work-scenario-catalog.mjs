// New business goals share the existing authorized-file workflow, not new agents.
export const WORK_SCENARIOS=[
 {id:'21',key:'clarify_requirements',title:'需求澄清与验收标准',type:'多轮',say:'把这些需求拆清楚，列出待确认问题和验收条件',scope:'核对上传需求与确认记录，区分已确认条件和建议；补充后可关联前次结果'},
 {id:'22',key:'verify_deliverables',title:'交付验收与补正',type:'多轮',say:'对照约定检查交付，指出缺项，补件后重新核验',scope:'逐项核对要求与实际材料，保留证据、缺口和补件变化；不把口头完成当作验收'},
 {id:'23',key:'reconcile_business_data',title:'业务数据对账与口径核对',type:'即时',say:'核对这两份业务数据，算清差异和重复项',scope:'对两份CSV、JSON记录或XLSX表按明确键逐行计算差异、重复与金额；筛选口径须有依据'},
 {id:'24',key:'trace_change_impact',title:'需求变更影响追踪',type:'即时',say:'这次变更会影响哪些后续任务和承诺',scope:'根据上传变更与依赖分析影响，输出调整建议；不擅自修改承诺或排期'},
 {id:'25',key:'locate_work_blockers',title:'协作依赖与阻塞定位',type:'即时',say:'查清这件事卡在哪里，下一步该找谁',scope:'从授权任务关系追踪未完成依赖、负责人和下一步；缺少节点与依赖环单列'},
 {id:'26',key:'prepare_work_handoff',title:'工作交接与接续',type:'多轮',say:'把项目整理成别人能接着办理的交接包',scope:'整理现状、依据、未完事项与接续动作，接手确认单独核对；未向他人发送'},
 {id:'27',key:'verify_feedback_resolution',title:'客户反馈与整改验收',type:'多轮',say:'归并客户反馈，核对哪些问题真正解决了',scope:'关联反馈、处理和复测依据，已回复不等于解决，仍有复现不关闭'},
 {id:'28',key:'prepare_role_readiness',title:'入职转岗办公准备',type:'多轮',say:'核对新岗位办公条件，跟清还缺哪些账号设备和手续',scope:'按岗位要求核对已有条件、申请与可用证明；不代开账号、不修改权限、不提交外部工单'}
];
