const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/youtube-ai-subtitles.user.js', 'utf8');
const parseSource = source.slice(source.indexOf('  function parseCues('), source.indexOf('  async function translate('));
const translateSource = source.slice(source.indexOf('  async function translate('), source.indexOf('  async function start('));
let reply;
const sandbox = {URL, LANGUAGES:{ko:'한국어',en:'영어',es:'스페인어'}, request:async () => reply};
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
  console.log('PASS: cue parsing, overlap clipping, translation validation, quota errors, timing boundaries');
})().catch(error => { console.error(error); process.exitCode=1; });