// db.js
const db = new Dexie('WordVault');
db.version(1).stores({
  words: '&word, count, lastUpdated'
});
