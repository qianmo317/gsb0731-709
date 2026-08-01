// background.js
importScripts('lib/dexie.min.js', 'db.js');

// 1. Shortcut Listener
chrome.commands.onCommand.addListener((command) => {
  if (command === 'translate-word') {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_TRANSLATION' })
             .catch(e => {
               console.log("Content script not ready:", e);
               chrome.scripting.executeScript({
                 target: { tabId: tabs[0].id },
                 func: () => {
                   // Inject a beautiful toast instead of alert
                   const existing = document.getElementById('wordvault-reload-toast');
                   if (existing) existing.remove();

                   const toast = document.createElement('div');
                   toast.id = 'wordvault-reload-toast';
                   Object.assign(toast.style, {
                     position: 'fixed',
                     top: '24px',
                     left: '50%',
                     transform: 'translateX(-50%)',
                     background: '#333',
                     color: '#fff',
                     padding: '12px 24px',
                     borderRadius: '8px',
                     fontSize: '14px',
                     fontWeight: '500',
                     boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                     zIndex: '2147483647',
                     fontFamily: 'system-ui, -apple-system, sans-serif',
                     transition: 'opacity 0.3s ease',
                     pointerEvents: 'none'
                   });
                   toast.textContent = "插件已更新，请刷新当前页面（按F5）后再试";
                   document.body.appendChild(toast);

                   setTimeout(() => {
                     toast.style.opacity = '0';
                     setTimeout(() => toast.remove(), 300);
                   }, 3000);
                 }
               }).catch(err => console.log("Failed to inject alert:", err));
             });
      }
    });
  }
});

// 2. Data & API Service
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'LOOKUP_WORD':
      handleLookup(msg.word).then(sendResponse);
      return true; // async
    case 'INCREMENT_COUNT':
      handleIncrement(msg.word).then(sendResponse);
      return true;
    case 'UPDATE_NOTE':
      handleUpdateNote(msg.word, msg.note).then(sendResponse);
      return true;
  }
});

// --- Handlers ---

async function handleLookup(rawWord) {
  const word = rawWord.toLowerCase().trim();
  if (!word) return { success: false, error: 'Empty input' };

  try {
    // A. Check Local DB
    let record = await db.words.get(word);

    if (record) {
      // HIT: Auto Increment on lookup (Requirement: "Auto accum")
      record.count = (record.count || 0) + 1;
      record.lastUpdated = Date.now();
      await db.words.put(record);
      return { success: true, data: record, source: 'DB' };
    }

    // B. MISS: Fetch API
    // Use Strategy Pattern (Google -> GoogleAlt -> MyMemory)
    let trans = "Translation unavailable";
    try {
      trans = await fetchTranslationStrategy(rawWord);
    } catch (e) {
      console.log("All translation strategies failed", e);
    }
    
    // Fetch Dictionary Metadata
    let meta = {};
    try {
      meta = await fetchDictionaryApi(rawWord);
    } catch(e) { /* ignore dict fail */ }

    const newRecord = {
      word: word,
      displayWord: rawWord,
      translation: trans,
      phonetic: meta.phonetic || "",
      pos: meta.pos || "",
      systemEx: meta.examples || [],
      customEx: [],
      count: 1, // First see
      lastUpdated: Date.now()
    };

    await db.words.put(newRecord);
    return { success: true, data: newRecord, source: 'API' };

  } catch (e) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

async function handleIncrement(wordKey) {
  try {
    const record = await db.words.get(wordKey);
    if (record) {
      record.count = (record.count || 0) + 1;
      await db.words.put(record);
      return { success: true, newCount: record.count };
    }
    return { success: false, error: 'Not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleUpdateNote(wordKey, note) {
  try {
    const record = await db.words.get(wordKey);
    if (record) {
      if (!record.customEx) record.customEx = [];
      record.customEx.push(note);
      await db.words.put(record);
      return { success: true };
    }
  } catch (e) { }
  return { success: false };
}

// --- API Helpers ---

// STRATEGY DISPATCHER
async function fetchTranslationStrategy(text) {
  // 1. Try Google API (Standard)
  try {
    return await fetchGoogleStandard(text);
  } catch(e) { console.log("Google Standard failed", e); }

  // 2. Try Google Web (Alternative Host)
  try {
    return await fetchGoogleWeb(text);
  } catch(e) { console.log("Google Web failed", e); }

  // 3. Try MyMemory (Free Public API)
  try {
    return await fetchMyMemory(text);
  } catch(e) { console.log("MyMemory failed", e); }

  throw new Error("All Backups Failed");
}

// -- Providers --

async function fetchGoogleStandard(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  const json = await res.json();
  return json[0]?.[0]?.[0] || "";
}

async function fetchGoogleWeb(text) {
  // Sometimes .com works where api. fails
  const url = `https://translate.google.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  const json = await res.json();
  return json[0]?.[0]?.[0] || "";
}

async function fetchMyMemory(text) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
  const res = await fetch(url);
  const json = await res.json();
  // status 200 means ok
  if (json.responseStatus === 200) {
    return json.responseData.translatedText;
  }
  throw new Error("MyMemory Error");
}

async function fetchDictionaryApi(text) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("No Dict Data");
  const json = await res.json();
  const entry = json[0];
  
  // Extract safest phonetic
  const phonetic = entry.phonetic || entry.phonetics?.find(p=>p.text)?.text || "";
  
  // Extract first POS
  const meaning = entry.meanings?.[0];
  const pos = meaning?.partOfSpeech || "";
  
  // Extract examples
  const examples = [];
  entry.meanings?.forEach(m => {
    m.definitions?.forEach(d => {
      if (d.example) examples.push(d.example);
    });
  });

  return { phonetic, pos, examples: examples.slice(0, 3) };
}
