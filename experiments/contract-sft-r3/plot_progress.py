"""Timestamped progress snapshot, never a claim of finished test performance."""
import argparse,json,statistics,sys
from pathlib import Path
def plot(root,arm,deps):
 sys.path.insert(0,str(deps))
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 from matplotlib.font_manager import FontProperties
 log=[json.loads(s) for s in (root/arm/'training-log.jsonl').read_text(encoding='utf-8').splitlines() if s]
 history=json.loads((root/arm/'validation-history.json').read_text(encoding='utf-8'))
 plt.rcParams['font.family']=FontProperties(fname='C:/Windows/Fonts/msyh.ttc').get_name();plt.rcParams['axes.unicode_minus']=False
 plt.rcParams.update({'axes.spines.top':False,'axes.spines.right':False,'font.size':10})
 fig,ax=plt.subplots(1,2,figsize=(12,4.4));x=[r['step'] for r in log];y=[r['loss'] for r in log]
 ax[0].plot(x,y,color='#b8bdc3',lw=.7,label='每步4条答案loss均值');ax[0].plot(x,[statistics.mean(y[max(0,i-19):i+1]) for i in range(len(y))],color='#285e87',label='后向20步均值')
 ax[0].set(title='训练loss：实际记录',xlabel='优化器更新步数（step）',ylabel='答案交叉熵（无单位）',ylim=(0,None));ax[0].legend(frameon=False)
 ax[1].plot([r['step'] for r in history],[r['dev_mean_corpus_f1'] for r in history],marker='o',color='#285e87',label='64条验证集，中英等权')
 for r in history:ax[1].annotate(f"{r['dev_mean_corpus_f1']:.3f}",(r['step'],r['dev_mean_corpus_f1']),xytext=(0,8),textcoords='offset points',ha='center')
 ax[1].set(title='验证F1：不是训练loss、不是最终测试',xlabel='优化器更新步数（step）',ylabel='精确答案集合F1（0–1）',ylim=(0,1));ax[1].legend(frameon=False)
 fig.suptitle(f'R3 {arm}进度快照 · step{x[-1]} · 任务仍在执行')
 fig.text(.02,.02,'来源：实际training-log.jsonl/validation-history.json。验证点间仅连线引导；低loss并不保证泛化。测试未参与选权重。',fontsize=8)
 fig.tight_layout(rect=[0,.05,1,.94]);p=root/f'progress-{arm}-step{x[-1]}.png';fig.savefig(p,dpi=140);plt.close(fig);print(str(p))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--arm',required=True);p.add_argument('--plot-deps',type=Path,required=True);a=p.parse_args();plot(a.root,a.arm,a.plot_deps)
