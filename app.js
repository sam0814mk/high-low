import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.HIGHLOW_CONFIG || {};
const $ = (id) => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sb, state, busy = false, timer, roomCode = localStorage.getItem('hl_room') || '';
let selectedTarget = null;
let lastStateJson = '';
const formatResult = { HIGH: 'HIGH', LOW: 'LOW', CORRECT: '正解！' };
const resultExplanation = { HIGH: '答えは予想した数字より大きい', LOW: '答えは予想した数字より小さい', CORRECT: '数字が一致！ 指名された人は脱落' };
const phaseText = { lobby:'参加受付', selecting:'数字選択', playing:'対戦中', between:'セット終了', finished:'優勝決定' };
function notice(message) { $('notice').textContent = message; show('notice', !!message); }
function errorMessage(error){ return error?.message || String(error); }
async function run(action){ if(busy)return;busy=true;try{await action();notice('');await refresh();}catch(e){notice(errorMessage(e));}finally{busy=false;} }
async function rpc(name, args={}){const {data,error}=await sb.rpc('hl_'+name,args);if(error)throw error;return data;}
async function init(){
  if(!cfg.supabaseUrl || !cfg.supabaseKey || cfg.supabaseUrl.includes('YOUR-PROJECT') || cfg.supabaseKey.includes('YOUR_')){
    notice('config.js に Supabase の Project URL と publishable（または anon）key を設定してください。');
    $('create').disabled=true;$('join').disabled=true;return;
  }
  sb=createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
  let {data:{session},error}=await sb.auth.getSession();if(error)throw error;
  if(!session){const r=await sb.auth.signInAnonymously();if(r.error)throw r.error;}
  if(roomCode){$('code').value=roomCode;await refresh();}
  timer=setInterval(()=>{if(roomCode && !busy && !document.hidden) refresh().catch(e=>notice(errorMessage(e)));},2000);
}
$('create').onclick=()=>run(async()=>{roomCode=await rpc('create_room',{p_name:$('name').value.trim()});localStorage.setItem('hl_room',roomCode);});
$('join').onclick=()=>run(async()=>{roomCode=await rpc('join_room',{p_code:$('code').value.trim().toUpperCase(),p_name:$('name').value.trim()});localStorage.setItem('hl_room',roomCode);});
$('leave').onclick=()=>{if(!confirm('この端末での表示を終了します。参加者データは削除されません。よろしいですか？'))return;roomCode='';state=null;lastStateJson='';localStorage.removeItem('hl_room');show('entry',true);show('game',false);notice('');};
async function refresh(){
 if(!roomCode)return;
 try{const nextState=await rpc('get_state',{p_code:roomCode});const nextJson=JSON.stringify(nextState);if(nextJson!==lastStateJson){state=nextState;lastStateJson=nextJson;render();}}
 catch(e){if(!state){roomCode='';localStorage.removeItem('hl_room');show('entry',true);show('game',false);}throw e;}
}
function render(){
 if(!state)return;show('entry',false);show('game',true);
 $('roomCode').textContent=state.code;$('setNo').textContent=state.set_no;$('range').textContent=`1〜${state.number_max}`;$('phase').textContent=phaseText[state.phase];
 const me=state.players.find(p=>p.id===state.me);const host=state.host_id===state.me;
 const currentId=state.turn_order?.[state.turn_pos-1];
 $('players').innerHTML=state.players.map(p=>`<div class="player ${p.id===state.me?'me':''} ${!p.alive?'dead':''}"><span>${esc(p.name)} ${p.id===state.host_id?'👑':''}</span><span class="tag ${!p.alive?'':'good'}">${!p.alive?'脱落':p.ready?'数字確定':'生存'}</span>${p.id===currentId && state.phase==='playing'?'<span class="tag turn">手番</span>':''}</div>`).join('');
 const history=(state.history||[]);
 const last=history[history.length-1];
 const showResult=!!last && ['playing','between','finished'].includes(state.phase) && (last.set===state.set_no || state.phase==='finished');
 show('latestResult',showResult);
 if(showResult){
   const result=last.result;
   $('latestResult').className=`result-panel result-${result.toLowerCase()}`;
   $('latestGuessContext').innerHTML=`<strong>${name(last.by)}</strong> が <strong>${name(last.target)}</strong> の数字を <span class="result-guess-number">${Number(last.number)}</span> と予想`;
   $('latestResultWord').textContent=formatResult[result]||result;
   $('latestResultDescription').textContent=resultExplanation[result]||'';
 }
 $('history').innerHTML=history.length?history.slice().reverse().map(g=>`<div class="historyitem"><div class="history-meta">SET ${Number(g.set)} / ${Number(g.round)}周目</div><div class="history-detail"><span>${name(g.by)} → ${name(g.target)} <strong class="history-number">${Number(g.number)}</strong></span><span class="history-result history-${String(g.result).toLowerCase()}">${formatResult[g.result]||esc(g.result)}</span></div></div>`).join(''):'<p class="foot">まだ予想履歴はありません。</p>';
 show('hostPanel',host && ['lobby','selecting','between'].includes(state.phase));
 const hostButton=$('hostAction');
 if(state.phase==='lobby') {hostButton.textContent='参加受付終了・数字選択へ';hostButton.onclick=()=>run(()=>rpc('host_action',{p_code:roomCode,p_action:'select'}));}
 if(state.phase==='selecting'){hostButton.textContent='全員確定後、サイコロを振って開始';hostButton.onclick=()=>run(()=>rpc('host_action',{p_code:roomCode,p_action:'play'}));}
 if(state.phase==='between'){hostButton.textContent='次のセットへ';hostButton.onclick=()=>run(()=>rpc('host_action',{p_code:roomCode,p_action:'next'}));}
 $('hint').textContent=host?'あなたは主催者です。管理ボタンから進行できます。':'主催者の操作または次の手番を待ちます。';
 renderAction(me,currentId);
}
function name(id){return esc(state.players.find(p=>p.id===id)?.name || '?');}
function renderAction(me,currentId){
 const content=$('actionContent'),buttons=$('actionButtons');buttons.replaceChildren();
 function add(text,action){const btn=document.createElement('button');btn.textContent=text;btn.onclick=action;buttons.append(btn);}
 if(state.phase==='lobby'){$('actionTitle').textContent='参加受付中';content.innerHTML='<p>主催者が数字選択を開始するまで待機してください。参加URLまたはルームコードを共有できます。</p>';add('参加URLをコピー',()=>navigator.clipboard.writeText(location.href.split('?')[0]+'?room='+roomCode).then(()=>notice('URLをコピーしました')).catch(()=>notice('URLのコピーに失敗しました')));return;}
 if(state.phase==='selecting'){
  $('actionTitle').textContent='秘密の数字を選ぶ';
  if(!me.alive){content.innerHTML='<p>脱落済みのため観戦中です。</p>';return;}
  const defaultNumber=state.my_number ?? Math.ceil(state.number_max/2);
  content.innerHTML=`<p>1〜${state.number_max}の数字を選んでください。他のプレイヤーには見えません。</p><label>あなたの数字<input type="number" id="myNumber" min="1" max="${state.number_max}" value="${defaultNumber}" /></label><p class="foot">${me.ready?'確定済み（変更可能）':'未確定'}</p>`;
  add('数字を確定',()=>run(()=>rpc('submit_number',{p_code:roomCode,p_number:Number($('myNumber').value)})));return;
 }
 if(state.phase==='between'){$('actionTitle').textContent='セット終了';content.innerHTML=`<p>4周が終了しました。${state.eliminated_this_set?'脱落者がいたため、次セットでは数字の上限が半減します。':'脱落者がいなかったため、数字の上限は変わりません。'}</p><p>次のセットで全員が数字を選び直します。</p>`;return;}
 if(state.phase==='finished'){$('actionTitle').textContent='ゲーム終了';content.innerHTML=`<p class="winner">🏆 ${name(state.winner_id)} の優勝！</p><p>参加ありがとうございました。</p>`;return;}
 $('actionTitle').textContent=`${state.round_no} / 4周目`;
 const turnName=name(currentId);
 const rolls=state.turn_order.map(id=>`${name(id)}：🎲${Number(state.dice[id] || 0)}`).join(' ／ ');
 if(!me.alive){content.innerHTML=`<p>あなたは脱落しました。現在の手番：${turnName}</p><p class="dice">サイコロ：${rolls}</p>`;return;}
 if(currentId!==state.me){content.innerHTML=`<p>現在の手番：<strong>${turnName}</strong></p><p>あなたの数字：<span class="emphasis">${state.my_number}</span></p><p class="dice">サイコロ：${rolls}</p>`;return;}
 const options=state.players.filter(p=>p.alive && p.id!==state.me);
 if(!options.some(p=>p.id===selectedTarget))selectedTarget=options[0]?.id;
 content.innerHTML=`<p>あなたの手番です。誰の数字を予想しますか？</p><label>指名相手<select id="target">${options.map(p=>`<option value="${p.id}" ${p.id===selectedTarget?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>予想する数字<input id="guessNumber" type="number" min="1" max="${state.number_max}" value="${Math.ceil(state.number_max/2)}" /></label><p>自分の数字：<strong>${state.my_number}</strong></p><p class="dice">サイコロ：${rolls}</p>`;
 $('target').onchange=e=>{selectedTarget=e.target.value;};
 add('この数字で予想する',()=>run(()=>rpc('guess',{p_code:roomCode,p_target:$('target').value,p_number:Number($('guessNumber').value)})));
}
const queryRoom=new URLSearchParams(location.search).get('room');if(queryRoom){roomCode=queryRoom.toUpperCase();localStorage.removeItem('hl_room');$('code').value=roomCode;roomCode='';}
init().catch(e=>notice(errorMessage(e)));
