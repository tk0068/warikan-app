(()=>{
  function main(){
    // --- State ---
    const state = {
      people: ["Aさん","Bさん","Cさん"],
      expenses: [] // {payer, amount, memo, id}
    };

    // --- Elements ---
    const el = (id)=>document.getElementById(id);
    const peoplePills = el('peoplePills');
    const payerSel = el('payer');
    const amountInp = el('amount');
    const memoInp = el('memo');
    const expenseList = el('expenseList');
    const peopleRows = el('peopleRows');
    const totalEl = el('total');
    const countEl = el('count');
    const perHeadEl = el('perHead');
    const settlementsEl = el('settlements');

    if(!peoplePills){
      console.error('peoplePills not found. DOM not ready?');
      return;
    }

    // --- Utils ---
    const yen = n => new Intl.NumberFormat('ja-JP').format(Math.round(n||0));
    const uid = () => Math.random().toString(36).slice(2,9);
    function escapeHtml(s){
      const map = {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"};
      return String(s).replace(/[&<>"']/g, m => map[m]);
    }
    function pickButtonFromEvent(e, selector){
      const t = e.target; // might be Text in some browsers
      if(t && t.closest){
        const btn = t.closest(selector);
        if(btn) return btn;
      }
      if(e.composedPath){
        const path = e.composedPath();
        for(const n of path){
          if(n && n.matches && n.matches(selector)) return n;
        }
      }
      return null;
    }

    // URL から状態復元（#s=base64）
    try{
      const hash = location.hash;
      if(hash.startsWith('#s=')){
        const json = decodeURIComponent(atob(decodeURIComponent(hash.slice(3))));
        const data = JSON.parse(json);
        if(Array.isArray(data.people) && Array.isArray(data.expenses)){
          state.people = data.people;
          state.expenses = data.expenses;
        }
      }
    }catch(e){ console.warn('URL state parse failed', e); }

    // --- Renderers ---
    function renderPeople(){
      peoplePills.innerHTML = '';
      state.people.forEach((name, idx)=>{
        const pill = document.createElement('div');
        pill.className = 'pill';
        pill.innerHTML = `
          <div><strong>${escapeHtml(name)}</strong></div>
          <small class="muted">#${idx+1}</small>
          <button type="button" class="btn danger" title="この参加者を削除" data-del="${idx}">削除</button>`;
        peoplePills.appendChild(pill);
      });

      // select
      payerSel.innerHTML = state.people.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    }

    function renderExpenses(){
      expenseList.innerHTML = '';
      if(state.expenses.length===0){
        const p = document.createElement('div');
        p.className = 'muted';
        p.textContent = '支出はまだありません。上のフォームから追加してください。';
        expenseList.appendChild(p);
        return;
      }
      state.expenses.forEach(ex=>{
        const row = document.createElement('div');
        row.className = 'expense-row';
        row.innerHTML = `
          <div class="expense-info">
            <div>
              <div><strong>${escapeHtml(ex.payer)}</strong></div>
              <div class="muted">${escapeHtml(ex.memo||'（メモなし）')}</div>
            </div>
            <div class="expense-amount mono">${yen(ex.amount)} 円</div>
          </div>
          <button type="button" class="btn danger" data-del-exp="${ex.id}">削除</button>
        `;
        expenseList.appendChild(row);
      })
    }

    function renderSummary(){
      const totals = calcTotals();
      totalEl.textContent = yen(totals.total);
      countEl.textContent = state.people.length;
      perHeadEl.textContent = yen(totals.perHead);

      // people table
      peopleRows.innerHTML = '';
      state.people.forEach(name=>{
        const paid = totals.paidBy[name]||0;
        const diff = paid - totals.perHead;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(name)}</td>
          <td class="right">${yen(paid)} 円</td>
          <td class="right" style="color:${diff>=0?'#22c55e':'#f87171'}">${diff>=0?'+':''}${yen(diff)} 円</td>
        `;
        peopleRows.appendChild(tr);
      });

      // settlements
      settlementsEl.innerHTML = '';
      const plan = settlePlan(totals);
      if(plan.length===0){
        const p = document.createElement('div');
        p.className = 'muted';
        p.textContent = '精算の必要はありません（全員ぴったり）';
        settlementsEl.appendChild(p);
      }else{
        plan.forEach(s=>{
          const div = document.createElement('div');
          div.className = 'row wrap';
          div.style.gap = '8px';
          div.innerHTML = `<span>💸 ${escapeHtml(s.from)}</span><span class="muted">→</span><span>${escapeHtml(s.to)}</span><span class="mono">${yen(s.amount)} 円</span>`;
          settlementsEl.appendChild(div);
        })
      }
    }

    function calcTotals(){
      const paidBy = Object.fromEntries(state.people.map(p=>[p,0]));
      let total = 0;
      for(const ex of state.expenses){
        const amt = Number(ex.amount)||0;
        total += amt;
        if(paidBy.hasOwnProperty(ex.payer)) paidBy[ex.payer]+=amt;
      }
      const perHead = state.people.length>0 ? total/state.people.length : 0;
      return {total, perHead, paidBy};
    }

    // 最小支払い回数を目指す貪欲法
    function settlePlan(totals){
      const creditors = []; // 受け取り側  diff>0
      const debtors = [];   // 支払い側    diff<0
      for(const name of state.people){
        const diff = (totals.paidBy[name]||0) - totals.perHead;
        if(Math.abs(diff) < 0.5) continue; // 50銭未満は丸め誤差として無視
        if(diff>0) creditors.push({name, amt: diff});
        else debtors.push({name, amt: -diff});
      }
      // 大きい順に並べる
      creditors.sort((a,b)=>b.amt-a.amt);
      debtors.sort((a,b)=>b.amt-a.amt);

      const out = [];
      let i=0,j=0;
      while(i<debtors.length && j<creditors.length){
        const d = debtors[i], c = creditors[j];
        const pay = Math.min(d.amt, c.amt);
        out.push({from:d.name, to:c.name, amount: Math.round(pay)});
        d.amt -= pay; c.amt -= pay;
        if(d.amt <= 0.5) i++; // 50銭未満は完了扱い
        if(c.amt <= 0.5) j++;
      }
      return out;
    }

    // --- Actions & Helpers ---
    function removePerson(index){
      if(index<0 || index>=state.people.length) return;
      state.people.splice(index,1);
      renderPeople(); renderSummary(); persistShadow();
    }
    function resetPeople(){
      state.people = ["Aさん","Bさん","Cさん"];
      renderPeople(); renderSummary(); persistShadow();
    }

    el('addPersonBtn').addEventListener('click',()=>{
      const name = el('newPerson').value.trim();
      if(!name) return;
      if(state.people.includes(name)) { alert('同名の参加者がいます'); return; }
      state.people.push(name); el('newPerson').value='';
      renderPeople(); renderSummary(); persistShadow();
    });

    // 参加者削除（peoplePills に対するイベント委譲 + composedPath フォールバック）
    peoplePills.addEventListener('click',(e)=>{
      const btn = pickButtonFromEvent(e, 'button[data-del]');
      if(!btn) return;
      const idx = parseInt(btn.getAttribute('data-del'),10);
      if(Number.isNaN(idx)) return;
      const name = state.people[idx];
      if(!confirm(`${name} を削除しますか？`)) return;
      removePerson(idx);
    });

    function addExpense(){
      const payer = payerSel.value;
      const amount = Number(amountInp.value);
      if(!payer || !isFinite(amount) || amount<=0){
        alert('支払者と正の金額を入力してください'); return;
      }
      state.expenses.push({id:uid(), payer, amount, memo:memoInp.value.trim()});
      amountInp.value=''; memoInp.value='';
      renderExpenses(); renderSummary(); persistShadow();
    }
    el('addExpenseBtn').addEventListener('click', addExpense);
    document.addEventListener('keydown',(e)=>{
      if((e.ctrlKey||e.metaKey) && e.key==='Enter'){ addExpense(); }
    });

    expenseList.addEventListener('click',(e)=>{
      const btn = pickButtonFromEvent(e, '[data-del-exp]');
      if(!btn) return;
      const id = btn.getAttribute('data-del-exp');
      if(!id) return;
      state.expenses = state.expenses.filter(x=>x.id!==id);
      renderExpenses(); renderSummary(); persistShadow();
    });

    el('clearExpensesBtn').addEventListener('click',()=>{
      if(!confirm('すべての支出を削除しますか？')) return;
      state.expenses = [];
      renderExpenses(); renderSummary(); persistShadow();
    });

    // 保存系
    const STORAGE_KEY = 'splitbill_v1';
    function persistShadow(){
      try{ sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch{}
    }
    function loadShadow(){
      try{ const s = sessionStorage.getItem(STORAGE_KEY); if(s){ Object.assign(state, JSON.parse(s)); } }catch{}
    }
    function saveLocal(){
      try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); alert('ローカル保存しました'); }catch(e){ alert('保存に失敗: '+e.message); }
    }
    function loadLocal(){
      try{
        const s = localStorage.getItem(STORAGE_KEY);
        if(!s) { alert('保存データがありません'); return; }
        Object.assign(state, JSON.parse(s));
        renderPeople(); renderExpenses(); renderSummary();
      }catch(e){ alert('復元に失敗: '+e.message); }
    }
    function wipeLocal(){ localStorage.removeItem(STORAGE_KEY); alert('保存データを削除しました'); }

    el('saveLocal').addEventListener('click', saveLocal);
    el('loadLocal').addEventListener('click', loadLocal);
    el('wipeLocal').addEventListener('click', wipeLocal);


    el('shareUrl').addEventListener('click',()=>{
      const encoded = encodeURIComponent(btoa(encodeURIComponent(JSON.stringify(state))));
      const url = location.origin + location.pathname + '#s=' + encoded;
      
      // クリップボードにコピーを試行
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => {
          alert('現在の状態を含むURLをクリップボードにコピーしました\n' + url);
        }).catch(() => {
          fallbackCopyToClipboard(url);
        });
      } else {
        fallbackCopyToClipboard(url);
      }
      
      function fallbackCopyToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          document.execCommand('copy');
          alert('現在の状態を含むURLをクリップボードにコピーしました\n' + text);
        } catch (err) {
          alert('クリップボードへのコピーに失敗しました。URLを手動でコピーしてください:\n' + text);
        }
        
        document.body.removeChild(textArea);
      }
    });

    // 初期化は id 直付け + 委譲の両対応
    el('resetPeopleBtn').addEventListener('click',()=>{
      if(!confirm('参加者を Aさん / Bさん / Cさん に初期化しますか？\n（支出はそのまま残ります）')) return;
      resetPeople();
    });
    document.addEventListener('click',(e)=>{
      const btn = pickButtonFromEvent(e, '#resetPeopleBtn');
      if(btn){
        if(!confirm('参加者を Aさん / Bさん / Cさん に初期化しますか？\n（支出はそのまま残ります）')) return;
        resetPeople();
      }
    });


    // --- Init ---
    loadShadow();
    renderPeople();
    renderExpenses();
    renderSummary();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', main, {once:true});
  }else{
    main();
  }
})();