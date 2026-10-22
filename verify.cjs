const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/youtube-ai-subtitles.user.js', 'utf8');
const parseSource = source.slice(source.indexOf('  function parseCues('), source.indexOf('  async function translate('));
const translateSource = source.slice(source.indexOf('  async function translate('), source.indexOf('  async function start('));
let reply, sentBody;
const sandbox = {URL, setTimeout, LANGUAGES:{ko:'한국어',en:'영어',es:'스페인어'}, request:async (url,options) => { sentBody = options?.data && JSON.parse(options.data); return reply; }};
vm.createContext(sandbox);
vm.runInContext(source.slice(source.indexOf('  function subtitleBottom('),source.indexOf('  function updateSubtitlePosition(')),sandbox);
assert.equal(sandbox.subtitleBottom(800,null,null),128);
assert.equal(sandbox.subtitleBottom(800,650,null),168);
assert.equal(sandbox.subtitleBottom(800,700,590),224);
assert.equal(sandbox.subtitleBottom(400,340,280),134);
vm.runInContext(parseSource + translateSource, sandbox);
const modelSource = source.slice(source.indexOf('  function normalizeModel('),source.indexOf('  async function tracks('));
vm.runInContext(modelSource, sandbox);
const metadata = sandbox.videoMetadata({videoDetails:{videoId:'video-a',title:'Reaction\n to Faker',author:'Jankos',shortDescription:'x'.repeat(3000)}},'video-a');
assert.equal(metadata.title,'Reaction to Faker');
assert.equal(metadata.description.length,1800);
assert.throws(() => sandbox.videoMetadata({videoDetails:{videoId:'old-video'}},'video-a'),/一致|일치/);
const contextCues = Array.from({length:60},(_,id) => ({id,text:`line ${id}`}));
const context = sandbox.translationContext(metadata,contextCues,contextCues.slice(15,30));
assert.equal(context.before.length,12);
assert.equal(context.after[0],'line 30');
assert.equal(context.before.includes('line 15'),false);
const feedbackSource = source.slice(source.indexOf('  function cueFeedback('),source.indexOf('  function request('));
vm.runInContext(feedbackSource, sandbox);
const cue = {id:0,start:0,end:2};
assert.match(sandbox.cueFeedback(cue,1,'',true,true),/우선 번역 중/);
assert.match(sandbox.cueFeedback(cue,1,'',true,false),/요청이 끝나면/);
assert.match(sandbox.cueFeedback(cue,1,'',false,false),/이어서/);
assert.equal(sandbox.cueFeedback(cue,1,'번역 완료',true,false),'');
assert.equal(sandbox.cueFeedback(cue,2,'',true,false),'');
assert.equal(sandbox.cueFeedback(undefined,1,'',true,false),'');
assert.equal(sandbox.normalizeModel(' models/gemini-example '),'gemini-example');
assert.equal(sandbox.eligibleModels([
  {name:'models/gemini-example',supportedGenerationMethods:['generateContent']},
  {name:'models/gemini-image',supportedGenerationMethods:['generateContent']},
  {name:'models/gemini-embed',supportedGenerationMethods:['embedContent']}
]).length,1);
const cues = sandbox.parseCues(JSON.stringify({events:[
  {tStartMs:0,dDurationMs:5000,segs:[{utf8:'Hello '},{utf8:'world'}]},
  {tStartMs:2000,dDurationMs:1000,segs:[{utf8:'Next'}]},
  {tStartMs:3000,segs:[{utf8:'\n'}]}
]}));
assert.equal(cues.length,2);
assert.equal(cues[0].end,2);
assert.equal(cues[0].text,'Hello world');
assert.equal(cues[1].id,1);
const response = rows => ({status:200,responseText:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(rows)}]}}]})});
(async () => {
  reply = response([{id:0,text:'안녕하세요'},{id:1,text:'다음'}]);
  assert.equal((await sandbox.translate(cues,[], 'test-key','test-model')).rows.length,2);
  reply = response([{id:0,text:'안녕'},{id:0,text:'중복'}]);
  assert.equal((await sandbox.translate(cues,[],'test-key','test-model')).missing.length,2);
  const recovered = sandbox.reconcileRows([{id:50},{id:53},{id:60}],[{id:0,text:'유효'},{id:1,text:''},{id:2,text:'중복'},{id:2,text:'중복'},{id:99,text:'범위 밖'}]);
  assert.equal(recovered.rows[0].id,50);
  assert.equal(recovered.missing.length,2);
  const mixed = [{id:70,text:'está bien'},{id:71,text:'always from the'}];
  const partial = sandbox.reconcileRows(mixed,[{id:0,text:'괜찮아'},{id:1,text:'always from the'}],'ko');
  assert.equal(partial.rows.length,1);
  assert.equal(partial.missing[0].id,71);
  assert.equal(sandbox.reconcileRows(mixed,[{id:0,text:'괜찮아'},{id:1,text:'항상 그곳에서'}],'ko').missing.length,0);
  assert.equal(sandbox.validTargetText('I’m one of','ko'),false);
  assert.equal(sandbox.validTargetText('Faker','ko'),true);
  assert.equal(sandbox.validTargetText('2015 ♪','ko'),true);
  assert.equal(sandbox.validTargetText('always from the','en'),true);
  assert.equal(sandbox.validTargetText('回る世界中！','ko'),false);
  assert.equal(sandbox.validTargetText('キュートなキューたい','ko'),false);
  assert.match(sandbox.scriptHint('回る世界中！ Pick up you!'),/Han.*Latin/);
  const song = [{id:0,start:0,end:2,text:'回る世界中！'},{id:1,start:2,end:4,text:'Pick up you! I want you!'}];
  reply = response([{id:0,text:'돌아가는 온 세상!'},{id:1,text:'Pick up you! I want you!'}]);
  const songResult = await sandbox.translate(song,{sourceLanguage:'ja'},'test-key','test-model','ko');
  assert.equal(songResult.rows.length,1);
  assert.equal(songResult.issues[1],'한국어 대신 외국어 반환');
  const payload = JSON.parse(sentBody.contents[0].parts[0].text);
  assert.match(payload.subtitles[1].scriptHint,/Latin/);
  assert.equal(payload.targetLanguage,'한국어');
  assert.match(payload.rule,/English hooks in Japanese songs/);
  reply = response([{id:0,text:'널 선택해! 널 원해!'}]);
  const fixedSong = await sandbox.translate([song[1]],{surroundingDialogue:[{original:song[0].text,existingKorean:'돌아가는 온 세상!'}]},'test-key','test-model','ko',[{id:0,reason:songResult.issues[1]}]);
  assert.equal(fixedSong.rows[0].id,1);
  const repairedPayload = JSON.parse(sentBody.contents[0].parts[0].text);
  assert.equal(repairedPayload.repairs[0].id,0);
  assert.equal(repairedPayload.context.surroundingDialogue[0].existingKorean,'돌아가는 온 세상!');
  const missingIssue = sandbox.reconcileRows(song,[{id:0,text:'정상'},{id:0,text:'중복'}]);
  assert.equal(missingIssue.issues[0],'자막 ID 중복');
  assert.equal(missingIssue.issues[1],'응답 누락');
  reply = {status:200,responseText:JSON.stringify({candidates:[{content:{parts:[{text:'[{oops'}]}}]})};
  assert.equal((await sandbox.translate(song,{},'test-key','test-model')).issues[0],'응답 JSON 형식 오류');
  const longCues = Array.from({length:85},(_,id) => ({id,start:id,end:id+1,text:'line'}));
  const blockedCue = new Map([[1,3]]), done = {0:'완료'};
  assert.equal(sandbox.pendingBatch(longCues,done,blockedCue,0)[0].id,2);
  assert.equal(sandbox.pendingBatch(song,{0:'정상'},new Map([[1,3]]),0).length,0);
  assert.equal(sandbox.pendingBatch(song,{0:'정상'},new Map(),0)[0].id,1);
  assert.match(sandbox.cueFeedback(song[1],3,'',false,false,'한국어 대신 외국어 반환'),/미해결 구간만 재시도/);
  let serverCalls = 0;
  const delays = [], notifications = [];
  sandbox.request = async () => ++serverCalls <= 2 ? {status:503} : response([{id:0,text:'복구 완료'}]);
  const serverResult = await sandbox.translateWithBackoff([song[1]],{},'test-key','test-model','ko',[],{wait:async ms => delays.push(ms),notify:m => notifications.push(m)});
  assert.equal(serverResult.rows.length,1);
  assert.equal(serverCalls,3);
  assert.equal(delays.length,2);
  assert.ok(delays[1] > delays[0]);
  assert.match(notifications[0],/503/);
  serverCalls=0;
  sandbox.request = async () => { serverCalls++; return {status:503}; };
  await assert.rejects(sandbox.translateWithBackoff(song,{},'test-key','test-model','ko',[],{wait:async () => {}}),/503/);
  assert.equal(serverCalls,4);
  serverCalls=0;
  sandbox.request = async () => { serverCalls++; return {status:429}; };
  await assert.rejects(sandbox.translateWithBackoff(song,{},'test-key','test-model','ko',[],{wait:async () => {}}),/한도/);
  assert.equal(serverCalls,1);
  let cancelled=false;
  serverCalls=0;
  sandbox.request = async () => { serverCalls++; return {status:503}; };
  await assert.rejects(sandbox.translateWithBackoff(song,{},'test-key','test-model','ko',[],{wait:async () => { cancelled=true; },guard:() => { if(cancelled) throw new Error('중지됨'); }}),/중지됨/);
  assert.equal(serverCalls,1);
  sandbox.request = async () => ({status:200,responseText:JSON.stringify({candidates:[{finishReason:'RECITATION',content:{parts:[{text:'partial'}]}}]})});
  await assert.rejects(sandbox.translate(song,{},'test-key','test-model'),/RECITATION/);
  sandbox.request = async () => reply;
  const retryContext = sandbox.translationContext(metadata,contextCues,[contextCues[15],contextCues[18]],{16:'이미 번역된 문장'});
  assert.equal(retryContext.surroundingDialogue.find(c => c.original === 'line 16').existingKorean,'이미 번역된 문장');
  assert.equal(retryContext.surroundingDialogue.find(c => c.original === 'line 16').requested,false);
  reply = {status:429};
  await assert.rejects(sandbox.translate(cues,[],'test-key','test-model'),/한도/);
  let pages = 0;
  sandbox.request = async url => {
    pages++;
    const next = new URL(url).searchParams.get('pageToken');
    return {status:200,responseText:JSON.stringify(next ? {models:[{name:'models/gemini-second',supportedGenerationMethods:['generateContent']}]} :
      {models:[{name:'models/gemini-first',supportedGenerationMethods:['generateContent']}],nextPageToken:'next'})};
  };
  assert.equal((await sandbox.listModels('test-key')).length,2);
  assert.equal(pages,2);
  // Verify binary-search timing at cue boundaries using the same algorithm as the renderer.
  const timingSource = source.slice(source.indexOf('    let low = 0, high = cues.length'),source.indexOf('    const translated = cue'));
  for (const [time,expected] of [[0,0],[1.99,0],[2,1],[3,null]]) {
    sandbox.cues=cues; sandbox.time=time;
    vm.runInContext('{' + timingSource + '; globalThis.active = cue && time < cue.end ? cue.id : null;}',sandbox);
    assert.equal(sandbox.active,expected);
  }
  // Run the actual start loop: one English cue fails three times, later cues still finish,
  // then retry-only must request just that cue and retain all saved Japanese translations.
  const store = new Map(), messages = [], batches = [];
  const retryButton = {}, trackSelect = {value:'auto',replaceChildren(){},append(){}};
  let repairMode = false;
  const pipeline = {
    URL, Set, Map, LANGUAGES:{ko:'한국어'}, DEFAULT_MODEL:'test-model', targetLanguage:'ko',
    generation:0, running:false, cues:[], translations:{}, unresolved:new Map(), activeBatch:new Set(),
    setTimeout:fn => { fn(); }, videoId:() => 'test-video', normalizeModel:x => x,
    document:{querySelector:() => ({currentTime:0}),createElement:() => ({})}, el:() => ({}),
    panel:{dataset:{state:'idle'},querySelector:s => s === 'select' ? trackSelect : retryButton},
    videoInfo:{textContent:'',style:{}},
    tracks:async () => ({tracks:[{vssId:'.ja',languageCode:'ja',baseUrl:'https://www.youtube.com/api/timedtext?v=test-video'}],metadata:{title:'Japanese and English song',uploader:'test'}}),
    GM_getValue:(k,d) => k === 'apiKey' ? 'test-key' : k === 'model' ? 'test-model' : store.has(k) ? JSON.parse(store.get(k)) : d,
    GM_setValue:(k,v) => store.set(k,JSON.stringify(v)),
    request:async (url,options) => {
      if (url.startsWith('https://www.youtube.com/')) return {status:200,responseText:JSON.stringify({events:Array.from({length:85},(_,id) => ({tStartMs:id*1000,dDurationMs:1000,segs:[{utf8:id === 1 ? 'Pick up you! I want you!' : '回る世界中！'}]}))})};
      const payload = JSON.parse(JSON.parse(options.data).contents[0].parts[0].text);
      batches.push(payload);
      return response(payload.subtitles.map(c => ({id:c.id,text:c.startSeconds === 1 && !repairMode ? c.text : `번역 ${c.startSeconds}`})));
    }
  };
  pipeline.stop = () => { pipeline.generation++; pipeline.running=false; pipeline.panel.dataset.state='idle'; };
  pipeline.setIndicator = state => { pipeline.panel.dataset.state=state; };
  pipeline.status = message => { messages.push(message); if(message.startsWith('번역 완료')) pipeline.setIndicator('complete'); };
  vm.createContext(pipeline);
  vm.runInContext(parseSource + translateSource + modelSource + source.slice(source.indexOf('  async function start('),source.indexOf("  panel.addEventListener('click'")),pipeline);
  await pipeline.start();
  assert.equal(Object.keys(pipeline.translations).length,84);
  assert.equal(pipeline.translations[84],'번역 84');
  assert.equal(pipeline.unresolved.get(1),'한국어 대신 외국어 반환');
  assert.equal(pipeline.panel.dataset.state,'partial');
  assert.equal(retryButton.hidden,false);
  assert.equal(batches.filter(b => b.subtitles.some(c => c.startSeconds === 1)).length,3);
  assert.ok(messages.some(m => m.includes('보류하고 계속')));
  repairMode=true;
  batches.length=0;
  await pipeline.start(true);
  assert.equal(batches.length,1);
  assert.equal(batches[0].subtitles.length,1);
  assert.equal(batches[0].subtitles[0].startSeconds,1);
  assert.equal(batches[0].repairs[0].reason,'한국어 대신 외국어 반환');
  assert.ok(batches[0].context.surroundingDialogue.some(c => c.existingKorean === '번역 0'));
  assert.equal(Object.keys(pipeline.translations).length,85);
  assert.equal(pipeline.panel.dataset.state,'complete');
  assert.equal(retryButton.hidden,true);
  // Revalidate old cache entries without discarding healthy translations.
  const cacheKey = [...store.keys()][0], oldCache = JSON.parse(store.get(cacheKey));
  oldCache[2]='回る世界中！';
  store.set(cacheKey,JSON.stringify(oldCache));
  batches.length=0;
  await pipeline.start();
  assert.equal(batches.length,1);
  assert.equal(batches[0].subtitles.length,1);
  assert.equal(batches[0].subtitles[0].startSeconds,2);
  assert.equal(pipeline.translations[1],'번역 1');
  console.log('PASS: mixed-language repair, continue after failure, cache reuse, retry-only, 503 backoff/cancellation, response diagnostics, cue timing');
})().catch(error => { console.error(error); process.exitCode=1; });