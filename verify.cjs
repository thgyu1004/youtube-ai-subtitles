const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/youtube-ai-subtitles.user.js', 'utf8');
const parseSource = source.slice(source.indexOf('  function parseCues('), source.indexOf('  async function translate('));
const translateSource = source.slice(source.indexOf('  async function translate('), source.indexOf('  async function start('));
let reply;
const sandbox = {URL, request:async () => reply};
vm.createContext(sandbox);
vm.runInContext(parseSource + translateSource, sandbox);
const modelSource = source.slice(source.indexOf('  function normalizeModel('),source.indexOf('  async function tracks('));
vm.runInContext(modelSource, sandbox);
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
  assert.equal((await sandbox.translate(cues,[], 'test-key','test-model')).length,2);
  reply = response([{id:0,text:'안녕'},{id:0,text:'중복'}]);
  await assert.rejects(sandbox.translate(cues,[],'test-key','test-model'),/개수/);
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