// Fila do HY 3D Studio: cole numa aba em https://hy3d.tencent.ai/robots.txt (logada).
// Antes, defina localStorage.fila = JSON.stringify([{n, geo, col, apose?, rig?}, ...]).
// Cada item passa por: geometria (texto) -> textura PBR [-> rig se rig:true].
// Sem a retopologia do site (vivia em "servidor lotado"): o Blender reduz os polígonos (Tools/Animacao/vestir.py).
// Casa as obras pelo requestId que nós mesmos geramos; no máximo 5 tarefas por conta.
window.hy = async (p, b = {}) => { const t = await (await fetch('/api/game3d/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).text(); return JSON.parse(t.trim().split('\n').pop()); };
window.rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
window.rsp = w => Object.values(w.modelInfo || {}).find(v => v && typeof v == 'object' && (v.fbxUrl || v.glbUrl || v.rigFbxUrl));
window.tick = async () => {
  const F = JSON.parse(localStorage.fila);
  const L = (await hy('general_info/get_works_list', { page: 1, pageSize: 60 })).data.list;
  const byReq = {}; for (const w of L) { try { byReq[JSON.parse(w.inputInfo).requestId] = w; } catch (e) {} }
  let running = L.filter(w => w.status == 0 || w.status == 1).length;
  const submit = async (it, path, body, stage) => {
    if (running >= 5) return;
    body.requestId = rid();
    const r = await hy(path, body);
    if (r.errNo == 200013) return;
    if (r.errNo) { it.err = r.errNo + ' ' + r.errMsg; return; }
    it.prevReq = it.req; it.prevStage = it.stage; it.req = body.requestId; it.stage = stage; running++;
  };
  for (const it of F) {
    if (it.stage == 'done' || it.stage == 'failed') continue;
    if (!it.stage) { await submit(it, 'geometry_generation/text2geometry', { model: '', singleImage: '', viewsImage: {}, faceCount: 50000, boundingBoxList: null, worksType: 1, dependOnWorksId: '', modelVersion: 'v3.1', apose: !!it.apose, prompt: it.geo }, 'geo'); continue; }
    const w = byReq[it.req]; if (!w) continue; it.wid = w.worksId;
    if (w.status == 3 || w.status == 4) {
      const msg = w.modelInfo?.errorMsg || '';
      // Servidor lotado (服务器爆满): volta um estágio e reenvia no próximo tick, até 3 vezes.
      if (msg.includes('爆满') && (it.retry || 0) < 3) { it.retry = (it.retry || 0) + 1; it.req = it.prevReq; it.stage = it.prevStage; continue; }
      it.err = msg + ' @' + it.stage; it.stage = 'failed'; continue;
    }
    if (w.status != 2) continue;
    const o = rsp(w); it['out_' + it.stage] = { fbx: o?.fbxUrl || o?.rigFbxUrl, glb: o?.glbUrl, img: o?.imageUrl };
    if (it.stage == 'geo' || it.stage == 'retopo') await submit(it, 'texture_painting/text2texture_v31', { worksType: 1, worksId: '', dependOnWorksId: w.worksId, fbxUrl: o.fbxUrl, imageUrl: '', glbUrl: '', pbrImageUrl: '', prompt: it.col, editType: 0, partFbxUrl: '', localNames: null, property: null, viewsImage: {}, segmentationInfo: '', keepUv: false, enablePbr: true, seamLess: false, texRes: '', texFmt: '' }, 'tex');
    else if (it.stage == 'tex' && it.rig) await submit(it, 'bone_skinning/bone_skinning', { worksType: 1, dependOnWorksId: w.worksId, fbxUrl: o.fbxUrl, isWithBone: false, isKeepBone: false, modelVersion: '' }, 'rig');
    else it.stage = 'done';
  }
  localStorage.fila = JSON.stringify(F);
  window.__last = new Date().toISOString();
};
clearInterval(window.__iv);
window.__iv = setInterval(() => tick().catch(e => window.__err = String(e)), 30000);
