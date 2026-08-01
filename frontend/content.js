// content.js
// Logic: Shortcut -> Get Selection -> Message Background -> Render Popup

let activeHost = null;

// 1. Listen for Shortcut Trigger
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TRIGGER_TRANSLATION') {
    processSelection();
  }
});

// 2. Click Listener (Only to close popup)
document.addEventListener('mousedown', (e) => {
  if (activeHost && !activeHost.contains(e.target)) {
    removePopup();
  }
});

async function processSelection() {
  const sel = window.getSelection();
  const rawText = sel ? sel.toString().trim() : "";
  
  if (!rawText) {
    showToast("获取选区文本失败，请重新选择");
    return;
  }
  if (rawText.length > 800) {
    showToast("选区文本过长，支持最多800个字符");
    return;
  }

  // Calculate coords based on selection
  let x = 0, y = 0;
  try {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    x = rect.left + window.scrollX;
    y = rect.bottom + window.scrollY + 8;
  } catch (e) {
    return;
  }

  showLoading(x, y);

  // Send to Background
  const res = await chrome.runtime.sendMessage({ 
    type: 'LOOKUP_WORD', 
    word: rawText 
  });

  if (res && res.success) {
    renderPopup(res.data, x, y);
  } else {
    removePopup();
    console.error("Lookup failed:", res?.error);
  }
}

// --- UI Rendering ---

function showLoading(x, y) {
  removePopup();
  activeHost = document.createElement('div');
  Object.assign(activeHost.style, {
    position: 'absolute',
    left: x + 'px',
    top: y + 'px',
    zIndex: 2147483647
  });
  const shadow = activeHost.attachShadow({mode:'open'});
  shadow.innerHTML = `<div style="background:#222;color:#fff;padding:6px 12px;border-radius:4px;font-size:12px;font-family:sans-serif;">查询中...</div>`;
  document.body.appendChild(activeHost);
}

function showToast(msg) {
  removePopup();
  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed',
    left: '50%',
    top: '20px',
    transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.8)',
    color: '#fff',
    padding: '8px 16px',
    borderRadius: '4px',
    fontSize: '14px',
    zIndex: 2147483647,
    fontFamily: 'sans-serif'
  });
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function removePopup() {
  if (activeHost) {
    activeHost.remove();
    activeHost = null;
  }
}

function renderPopup(data, x, y) {
  removePopup();
  activeHost = document.createElement('div');
  Object.assign(activeHost.style, {
    position: 'absolute',
    left: x + 'px',
    top: y + 'px',
    zIndex: 2147483647
  });
  document.body.appendChild(activeHost);
  
  const shadow = activeHost.attachShadow({mode:'open'});
  
  // Prepare Lists
  const sysEx = (data.systemEx || []).map(e => `<li>${e}</li>`).join('');
  const cusEx = (data.customEx || []).map(e => `<li class="my-note">${escapeHtml(e)}</li>`).join('');
  
  shadow.innerHTML = `
    <style>
      .card { font-family:-apple-system, sans-serif; width:300px; background:#fff; border:1px solid #ddd; box-shadow:0 4px 12px rgba(0,0,0,0.15); border-radius:8px; padding:16px; color:#333; box-sizing:border-box; }
      .head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; border-bottom:1px solid #f0f0f0; padding-bottom:8px;}
      .w-main { font-size:18px; font-weight:700; color:#2c3e50; }
      .w-ph { font-family:monospace; font-size:13px; color:#7f8c8d; }
      .tag { font-size:10px; text-transform:uppercase; background:#e0f7fa; color:#006064; padding:2px 6px; border-radius:4px; display:inline-block; margin-bottom:5px; font-weight:bold;}
      .meaning { font-size:15px; line-height:1.4; color:#2c3e50; margin-bottom:10px; }
      .sec { margin-top:12px; padding-top:8px; border-top:1px dashed #eee; }
      .lbl { font-size:10px; font-weight:bold; color:#aaa; margin-bottom:4px; text-transform:uppercase; }
      ul { padding-left:15px; margin:0; }
      li { font-size:12px; color:#555; margin-bottom:3px; }
      li.my-note { color:#e91e63; }
      .row { display:flex; gap:6px; margin-top:8px; }
      input { flex:1; padding:5px; border:1px solid #ccc; border-radius:4px; font-size:12px; }
      button { border:none; padding:6px 10px; border-radius:4px; font-size:12px; cursor:pointer; font-weight:600; }
      .btn-save { background:#1a73e8; color:#fff; }
      .btn-inc { background:#27ae60; color:#fff; display:flex; align-items:center; gap:4px; }
      .btn-inc:active { transform:translateY(1px); }
      .stat-row { display:flex; justify-content:space-between; align-items:center; margin-top:12px; font-size:11px; color:#999; }
    </style>
    <div class="card">
      <div class="head">
        <span class="w-main">${escapeHtml(data.displayWord || data.word)}</span>
        <span class="w-ph">${data.phonetic ? `[${data.phonetic}]` : ''}</span>
      </div>
      ${data.pos ? `<span class="tag">${data.pos}</span>` : ''}
      <div class="meaning">${data.translation}</div>
      
      ${sysEx ? `<div class="sec"><div class="lbl">例句</div><ul>${sysEx}</ul></div>` : ''}
      
      <div class="sec">
        <div class="lbl">我的笔记</div>
        <ul id="list-notes">${cusEx || '<li style="list-style:none;color:#ccc">暂无笔记</li>'}</ul>
        <div class="row">
           <input id="inp" placeholder="添加笔记...">
           <button class="btn-save" id="btn-save">保存</button>
        </div>
      </div>
      
      <div class="stat-row">
         <span>已复习: <b id="cnt-val" style="color:#27ae60; font-size:13px;">${data.count}</b> 次</span>
         <button class="btn-inc" id="btn-inc">+1 复习</button>
      </div>
    </div>
  `;

  // Interaction
  const btnInc = shadow.getElementById('btn-inc');
  const cntVal = shadow.getElementById('cnt-val');
  const inp = shadow.getElementById('inp');
  const btnSave = shadow.getElementById('btn-save');
  const list = shadow.getElementById('list-notes');

  // Manual +1
  btnInc.addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'INCREMENT_COUNT', word: data.word });
    if (res && res.success) {
      cntVal.textContent = res.newCount;
      btnInc.textContent = "✓";
      setTimeout(() => btnInc.textContent = "+1 复习", 1000);
    }
  });

  // Save Note
  const doSave = async () => {
    const txt = inp.value.trim();
    if (!txt) return;
    
    if (list.innerText.includes('No notes')) list.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'my-note';
    li.textContent = txt;
    list.appendChild(li);
    inp.value = '';
    
    await chrome.runtime.sendMessage({ type: 'UPDATE_NOTE', word: data.word, note: txt });
  };
  
  btnSave.addEventListener('click', doSave);
  inp.addEventListener('keydown', e => { if(e.key==='Enter') doSave(); });
}

function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;");
}
