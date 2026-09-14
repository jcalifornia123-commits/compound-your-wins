/* Phone-local storage for Compound Your Wins.
   Mirrors server.py's validate()/validate_links()/read()/write() so the
   phone app behaves the same as the Mac app, but everything stays in this
   device's IndexedDB. No network, no server, no access key. */
(function(global){
'use strict';

const DB_NAME='compound-wins-db';
const DB_VERSION=1;
const CURRENCIES=['USD','EUR','GBP','CAD'];
const BUSINESS_KINDS=['company','income','sales','investment','reinvestment'];
const GROWTH_KINDS=['practice','shift'];

function todayISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function isValidISODate(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const [y,m,day]=s.split('-').map(Number);
  const d=new Date(Date.UTC(y,m-1,day));
  return d.getUTCFullYear()===y&&d.getUTCMonth()+1===m&&d.getUTCDate()===day;
}

function validateMemory(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid memory');
  const out={};
  for(const [key,limit] of [['id',100],['title',200],['category',40],['date',10],['notes',20000],['chapter',100]]){
    const value=raw[key]===undefined||raw[key]===null?'':raw[key];
    if(typeof value!=='string'||value.length>limit)throw new Error('Invalid '+key);
    out[key]=value.trim();
  }
  if(!(out.id&&out.title&&out.category&&out.date))throw new Error('A title, date and area are required');
  if(!isValidISODate(out.date))throw new Error('Choose today or a date in the past');
  if(out.date>todayISO())throw new Error('Choose today or a date in the past');
  out.highlight=raw.highlight===true;
  out.archived=raw.archived===true;
  const business=raw.business;
  if(business!==undefined&&business!==null){
    if(typeof business!=='object'||Array.isArray(business))throw new Error('Invalid business event');
    const kind=business.kind;
    if(!BUSINESS_KINDS.includes(kind))throw new Error('Choose a business event type');
    const b={kind};
    for(const [key,max] of [['company',100],['sourceId',100],['currency',3]]){
      const value=business[key]===undefined||business[key]===null?(key==='currency'?'USD':''):business[key];
      if(typeof value!=='string'||value.length>max)throw new Error('Invalid '+key);
      b[key]=value.trim();
    }
    if(!b.company)throw new Error('Name the company or job');
    if(!CURRENCIES.includes(b.currency))throw new Error('Choose a supported currency');
    const amount=business.amountCents===undefined?0:business.amountCents;
    if(!Number.isInteger(amount)||amount<0||amount>100000000000000)throw new Error('Enter a valid amount');
    if(kind!=='company'&&amount===0)throw new Error('Enter an amount greater than zero');
    b.amountCents=amount;
    out.business=b;
  }
  const growth=raw.growth;
  if(growth!==undefined&&growth!==null){
    if(typeof growth!=='object'||Array.isArray(growth))throw new Error('Invalid growth event');
    const kind=growth.kind;
    if(!GROWTH_KINDS.includes(kind))throw new Error('Choose a growth event type');
    const g={kind};
    const practice=growth.practice===undefined||growth.practice===null?'':growth.practice;
    if(typeof practice!=='string'||practice.length>100)throw new Error('Invalid practice');
    g.practice=practice.trim();
    if(!g.practice)throw new Error('Name the practice or habit');
    const source=growth.sourceId===undefined||growth.sourceId===null?'':growth.sourceId;
    if(typeof source!=='string'||source.length>100)throw new Error('Invalid sourceId');
    g.sourceId=source.trim();
    out.growth=g;
  }
  return out;
}

function validateLinkChain(entriesById,field){
  for(const e of Object.values(entriesById)){
    const link=e[field]||{};
    const source=link.sourceId;
    if(!source)continue;
    if(!(source in entriesById))throw new Error('The linked source is missing; import its memory too');
    const parent=entriesById[source];
    if(parent.date>e.date)throw new Error('A linked source must happen on or before this event');
    const seen=new Set([e.id]);
    let current=e;
    while(current[field]&&current[field].sourceId){
      const key=current[field].sourceId;
      if(seen.has(key))throw new Error('These links form a loop. Choose an earlier source');
      seen.add(key);
      if(!(key in entriesById))throw new Error('A linked source is missing');
      current=entriesById[key];
    }
  }
}

function validateLinks(entriesById){
  validateLinkChain(entriesById,'business');
  validateLinkChain(entriesById,'growth');
}

function reqp(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage transaction was interrupted.'))})}

let dbPromise=null;
function getDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('memories'))db.createObjectStore('memories',{keyPath:'id'});
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
      if(!db.objectStoreNames.contains('snapshots'))db.createObjectStore('snapshots',{keyPath:'date'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}

async function readAll(){
  const db=await getDB();
  const tx=db.transaction(['memories','meta'],'readonly');
  const entriesP=reqp(tx.objectStore('memories').getAll());
  const savedAtP=reqp(tx.objectStore('meta').get('savedAt'));
  const [entries,savedAtRow]=await Promise.all([entriesP,savedAtP]);
  await txDone(tx);
  return {version:2,entries,savedAt:savedAtRow?savedAtRow.value:''};
}

// One transaction: read current state, validate against it, write everything
// together, or write nothing at all if validation fails.
async function commit(mutate){
  const db=await getDB();
  const tx=db.transaction(['memories','meta','snapshots'],'readwrite');
  const memStore=tx.objectStore('memories');
  const metaStore=tx.objectStore('meta');
  const snapStore=tx.objectStore('snapshots');
  const existing=await reqp(memStore.getAll());
  const entriesById=Object.fromEntries(existing.map(e=>[e.id,e]));
  const result=mutate(entriesById); // may throw; if it does, nothing below runs
  validateLinks(entriesById);
  metaStore.put({key:'previous',value:existing});
  const finalList=Object.values(entriesById);
  for(const e of finalList)memStore.put(e);
  const savedAt=new Date().toISOString();
  metaStore.put({key:'savedAt',value:savedAt});
  snapStore.put({date:todayISO(),entries:finalList,savedAt});
  await txDone(tx);
  return {archive:{version:2,entries:finalList,savedAt},extra:result};
}

async function saveMemory(raw){
  const {archive}=await commit(entriesById=>{
    const validated=validateMemory(raw);
    entriesById[validated.id]=validated;
  });
  return archive;
}

async function importMemories(rawList){
  if(!Array.isArray(rawList))throw new Error('Invalid backup');
  const incoming=rawList.map(validateMemory); // validate all before touching anything
  const {archive,extra}=await commit(entriesById=>{
    let added=0;
    for(const e of incoming){if(!(e.id in entriesById)){entriesById[e.id]=e;added++}}
    return added;
  });
  return {archive,added:extra};
}

async function previousSnapshot(){
  const db=await getDB();
  const tx=db.transaction('meta','readonly');
  const row=await reqp(tx.objectStore('meta').get('previous'));
  await txDone(tx);
  return row?row.value:null;
}

async function requestPersistence(){
  try{
    if(!(navigator.storage&&navigator.storage.persist))return {supported:false,persisted:false};
    const already=await navigator.storage.persisted();
    const persisted=already||await navigator.storage.persist();
    return {supported:true,persisted};
  }catch{return {supported:false,persisted:false}}
}

global.WinsDB={readAll,saveMemory,importMemories,validateMemory,validateLinks,previousSnapshot,requestPersistence};
})(window);
