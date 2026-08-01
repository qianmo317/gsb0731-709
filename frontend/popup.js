// popup.js
// Connects to same DB as background.js

async function loadWords() {
  const ul = document.getElementById('word-list');
  const countSpan = document.getElementById('total-count');
  
  try {
    const words = await db.words.orderBy('lastUpdated').reverse().toArray();
    countSpan.textContent = `${words.length} 个单词`;
    ul.innerHTML = '';

    if (words.length === 0) {
      ul.innerHTML = '<li class="item" style="justify-content:center; color:#888;">暂无收集的单词</li>';
      return;
    }

    words.forEach(w => {
      const li = document.createElement('li');
      li.className = 'item';
      li.innerHTML = `
        <div class="row-main">
          <div style="flex:1;">
             <span class="w-text">${escapeHtml(w.displayWord || w.word)}</span>
             <span style="font-size:11px;color:#888; margin-left:5px;">(${w.count} 次)</span>
          </div>
          <span class="w-badge">${w.pos || '单词'}</span>
        </div>
        <div style="font-size:12px; color:#555; margin-top:2px;">${w.translation}</div>
      `;
      ul.appendChild(li);
    });

  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li style="padding:10px;color:red">数据库连接失败</li>';
  }
}

function escapeHtml(s) {
  return s ? s.replace(/</g, "&lt;") : "";
}

document.addEventListener('DOMContentLoaded', loadWords);
