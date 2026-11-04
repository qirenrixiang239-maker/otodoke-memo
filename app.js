/*
  お届け先メモ ― JavaScript(動き)
  「ボタンが押されたら何をするか」「データをどこに保存するか」を書いています。
  大きく分けて、
    1. 準備(設定値・道具になる小さな関数)
    2. 保存(この端末の中だけ)とバックアップ
    3. 画面を作る(お客さん一覧を描く)
    4. ボタンを押したときの動き
    5. 追加・編集画面
  の順に並んでいます。
*/

/* ===== 1. 準備 ===== */

// 期限が「あと何か月」になったら黄色で知らせるか
const EXPIRY_SOON_MONTHS = 6;
const LS_KEY = "otodoke-memo-v1";

// アプリが今覚えている情報
let customers = [];      // {id, ...data}
let mode = "loading";    // "local"(読み込み完了)| "loading"
let filter = "all";
let editingId = null;
let detailId = null;      // 詳細画面で開いているお客さんの id(閉じているときは null)
let undoFn = null, toastTimer = null;

// よく使う小さな道具
// $(...)  : 画面の部品を探す
// esc(...): 入力された文字を安全に表示できる形にする
// today() : 今日の日付を「2026-10-23」の形で返す
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const fmtDate = s => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${+m}/${+d}`; };
// 期限(「2031-03」の形)を「2031年3月」の表示にする
const fmtYM = s => { const [y, m] = s.split("-"); return `${y}年${+m}月`; };
// 「2031/3」「2031-3」「203103」なども「2031-03」の形にそろえる(合わない入力は null)
const normYM = v => { v = v.trim(); if (!v) return ""; const m = v.match(/^(\d{4})\D?(\d{1,2})$/); return m && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2].padStart(2, "0")}` : null; };
// 期限まであと何か月か(今月なら 0、過ぎていたらマイナス)
const monthsLeft = s => { const [y, m] = s.split("-").map(Number); const d = new Date(); return (y * 12 + m) - (d.getFullYear() * 12 + d.getMonth() + 1); };
const daysAgo = s => { if (!s) return null; const ms = new Date(today()) - new Date(s); return Math.round(ms / 864e5); };

/* ===== 2. 保存(この端末の中だけ) ===== */
// データは、このスマホ・タブレットのブラウザの中(localStorage)だけに保存する。
// インターネットには一切送らない。
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(customers)); return true; }
  catch (e) { showNotice("保存できませんでした。端末の空き容量を確認してください。"); return false; }
}
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { return null; }
}

// お客さん1人分の情報を保存する
async function writeDoc(c) {
  const { id, ...data } = c;
  data.updatedAt = new Date().toISOString();
  const i = customers.findIndex(x => x.id === id);
  if (i >= 0) customers[i] = { id, ...data }; else customers.push({ id, ...data });
  saveLocal(); render();
}
// お客さん1人分の情報を削除する
async function removeDoc(id) {
  customers = customers.filter(x => x.id !== id); saveLocal(); render();
}
function newId() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function showNotice(msg) { $("#notice").innerHTML = msg ? `<div class="notice">${esc(msg)}</div>` : ""; }

// 初めて起動したときだけ入れる見本データ(「(例)」付き。不要なら削除してOK)
const EXAMPLES = [
  { id: "ex1", name: "（例）田中", address: "岩村田1234", meterMaker: "（例）サンプル計器", meterModel: "NB4-X", meterPitch: "130", meterExpiry: "2031-03", regMaker: "（例）サンプル製作所", regModel: "R-10K", regType: "N型", regExpiry: "2027-02", cylNo: "C-20481", capacity: "50kg", cylCount: "2本", absent: 0, lastDelivered: "" },
  { id: "ex2", name: "（例）佐藤", address: "岩村田2051", meterMaker: "（例）サンプル計器", meterModel: "NB6-Y", meterPitch: "90", meterExpiry: "2026-09", regMaker: "（例）サンプル製作所", regModel: "R-5K", regType: "F型", regExpiry: "2033-11", cylNo: "C-11730", capacity: "20kg", cylCount: "1本", absent: 0, lastDelivered: "" },
];

// アプリ起動時の処理:端末の中からデータを読み込む
async function init() {
  const saved = loadLocal();
  if (saved === null) { customers = EXAMPLES.map(x => ({ ...x })); saveLocal(); }
  else customers = saved;
  mode = "local";
  render();
  loadThumbs();
  try { await cleanupPhotos(); } catch (e) {}
  // 端末の容量が少なくなっても、勝手に消されないようにお願いする
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
}

/* ===== 2-1. 建物の写真(この端末の中だけ) ===== */
// 写真は大きいので、お客さんのデータ(localStorage)とは別の、写真用の保存場所(IndexedDB)に入れる。
// お客さんのデータには、写真の名前(photoId)だけを書いておく。
const PHOTO_FULL_PX = 1280, PHOTO_THUMB_PX = 160;   // 保存するときの大きさ(長い辺のピクセル数)
let photoDBp = null;
function photoDB() {
  if (!photoDBp) photoDBp = new Promise((ok, ng) => {
    const r = indexedDB.open("otodoke-photos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos");
    r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error);
  });
  return photoDBp;
}
async function photoStore(mode, fn) {
  const db = await photoDB();
  return new Promise((ok, ng) => {
    const tx = db.transaction("photos", mode); const req = fn(tx.objectStore("photos"));
    tx.oncomplete = () => ok(req && req.result); tx.onerror = () => ng(tx.error); tx.onabort = () => ng(tx.error);
  });
}
const putPhoto = (id, rec) => photoStore("readwrite", st => st.put(rec, id));   // rec = { full: 画像, thumb: 小さい画像 }
const getPhoto = id => photoStore("readonly", st => st.get(id));
const delPhoto = id => photoStore("readwrite", st => st.delete(id));
const allPhotoIds = () => photoStore("readonly", st => st.getAllKeys());

// 写真を表示するための一時的なアドレス(一度作ったら覚えておく)
const photoURLs = {};   // { photoId: { thumb: "blob:…", full: "blob:…" } }
async function photoURL(id, size) {
  if (photoURLs[id]?.[size]) return photoURLs[id][size];
  const rec = await getPhoto(id); if (!rec?.[size]) return null;
  (photoURLs[id] ||= {})[size] = URL.createObjectURL(rec[size]);
  return photoURLs[id][size];
}
// 一覧に出す小さな写真をまとめて読み込み、読み終わったら一覧を描き直す
async function loadThumbs() {
  const need = customers.filter(c => c.photoId && !photoURLs[c.photoId]?.thumb);
  if (!need.length) return;
  for (const c of need) { try { await photoURL(c.photoId, "thumb"); } catch (e) {} }
  render();
}

// 写真を小さくして JPEG にする(向きはスマホの撮影向きに合わせる)
async function shrinkImage(blob, maxPx, quality) {
  let src;
  try { src = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch (e) {   // 古い端末向け:img 要素で読み込む
    src = await new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = URL.createObjectURL(blob); });
  }
  const w0 = src.width, h0 = src.height, k = Math.min(1, maxPx / Math.max(w0, h0));
  const cv = document.createElement("canvas"); cv.width = Math.round(w0 * k); cv.height = Math.round(h0 * k);
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
  return new Promise((ok, ng) => cv.toBlob(b => b ? ok(b) : ng(new Error("toBlob")), "image/jpeg", quality));
}
async function makePhoto(blob) {
  const full = await shrinkImage(blob, PHOTO_FULL_PX, 0.78);
  const thumb = await shrinkImage(full, PHOTO_THUMB_PX, 0.72);
  return { full, thumb };
}
// どのお客さんにも使われていない写真を片付ける(起動したときに行う)
async function cleanupPhotos() {
  const used = new Set(customers.map(c => c.photoId).filter(Boolean));
  for (const id of await allPhotoIds()) if (!used.has(id)) await delPhoto(id);
}

/* ===== 2-2. バックアップ(機種変更・端末の間の引っ越し用) ===== */
// 全データを1つのファイルに書き出す
// 画像 ⇔ 文字(バックアップファイルに入れるため)
const blobToDataURL = blob => new Promise((ok, ng) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ng; r.readAsDataURL(blob); });
const dataURLToBlob = async d => (await fetch(d)).blob();

// 全データを1つのファイルに書き出す(写真も入れる)
async function exportBackup() {
  $("#b-export").disabled = true; $("#b-export").textContent = "書き出しています…";
  try {
    const photos = {};
    for (const c of customers) if (c.photoId && !photos[c.photoId]) {
      try { const rec = await getPhoto(c.photoId); if (rec?.full) photos[c.photoId] = await blobToDataURL(rec.full); } catch (e) {}
    }
    const json = JSON.stringify({ app: "otodoke-memo", version: 2, exportedAt: new Date().toISOString(), customers, photos });
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `otodoke-memo_${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    try { localStorage.setItem(LS_KEY + "-lastBackup", today()); } catch (e) {}
    renderBackupInfo();
    const n = Object.keys(photos).length;
    toast(`${customers.length}件を書き出しました${n ? `(写真${n}枚)` : ""}`);
  } finally { $("#b-export").disabled = false; $("#b-export").textContent = "データを書き出す"; }
}
// 書き出したファイルを読み込んで、データを置き換える(写真なしの古いファイルも読める)
async function importBackup(file) {
  try {
    const obj = JSON.parse(await file.text());
    if (!obj || obj.app !== "otodoke-memo" || !Array.isArray(obj.customers)) throw new Error("bad");
    for (const [id, d] of Object.entries(obj.photos || {})) {
      try { const full = await dataURLToBlob(d); await putPhoto(id, { full, thumb: await shrinkImage(full, PHOTO_THUMB_PX, 0.72) }); } catch (e) {}
    }
    const before = customers;
    customers = obj.customers;
    saveLocal(); render(); loadThumbs(); closeBackup();
    toast(`${customers.length}件を読み込みました`, () => { customers = before; saveLocal(); render(); loadThumbs(); });
  } catch (e) {
    $("#b-err").textContent = "このファイルは読み込めません。お届け先メモで書き出したファイル(.json)を選んでください。";
    $("#b-err").hidden = false;
  }
}
function renderBackupInfo() {
  let last = null; try { last = localStorage.getItem(LS_KEY + "-lastBackup"); } catch (e) {}
  const np = customers.filter(c => c.photoId).length;
  $("#b-info").textContent = `この端末に ${customers.length}件(写真${np}枚)保存されています。前回の書き出し:${last ? fmtDate(last) : "まだありません"}。写真もファイルに入るので、写真が多いとファイルが大きくなります。`;
}
function openBackup() { renderBackupInfo(); $("#b-err").hidden = true; $("#scrim").hidden = false; $("#backup").hidden = false; }
function closeBackup() { $("#backup").hidden = true; if ($("#sheet").hidden) $("#scrim").hidden = true; }

/* ===== 2-3. Excel 書き出し ===== */
// Excel に載せられる項目の一覧(group が同じものは見出しをまとめる)
const FIELDS = [
  { key: "name", group: "", label: "名前", required: true },
  { key: "address", group: "", label: "住所", max: 26 },
  { key: "meterMaker", group: "メーター", label: "会社名", max: 16 },
  { key: "meterModel", group: "メーター", label: "型式" },
  { key: "meterPitch", group: "メーター", label: "ピッチ" },
  { key: "meterExpiry", group: "メーター", label: "期限", type: "ym" },
  { key: "regMaker", group: "調整器", label: "会社名", max: 16 },
  { key: "regModel", group: "調整器", label: "型式" },
  { key: "regType", group: "調整器", label: "型" },
  { key: "regExpiry", group: "調整器", label: "期限", type: "ym" },
  { key: "cylNo", group: "ボンベ", label: "番号" },
  { key: "capacity", group: "ボンベ", label: "容量" },
  { key: "cylCount", group: "ボンベ", label: "本数" },
  { key: "lastDelivered", group: "記録", label: "前回配達", type: "date" },
  { key: "absent", group: "記録", label: "不在回数", type: "count" },
];
const XLS_KEY = LS_KEY + "-xlsFields2";   // 項目を変えたので、選択の記憶を新しくする
let xlsPick = new Set(FIELDS.filter(f => f.group !== "記録").map(f => f.key));
try {
  const saved = JSON.parse(localStorage.getItem(XLS_KEY) || "null");
  if (Array.isArray(saved)) {
    xlsPick = new Set(saved);
    // 「本数」が増える前の選択を使っている人は、容量を選んでいれば本数も選んだ状態にする
    if (!localStorage.getItem(XLS_KEY + "-cylCount")) { if (xlsPick.has("capacity")) xlsPick.add("cylCount"); localStorage.setItem(XLS_KEY + "-cylCount", "1"); }
  }
} catch (e) {}
xlsPick.add("name");

// 今の一覧(検索・絞り込み)に出ている人を、一覧と同じ順番で返す
const byAddr = (a, b) => (a.address || "").localeCompare(b.address || "", "ja", { numeric: true }) || (a.name || "").localeCompare(b.name || "", "ja");
function shownCustomers() { const q = $("#q").value.trim(); return customers.filter(c => matches(c, q)).sort(byAddr); }

function renderXlsFields() {
  const groups = [...new Set(FIELDS.map(f => f.group))];
  $("#x-fields").innerHTML = groups.map(g => `<div class="x-group"><span class="g">${g || "基本"}</span>${
    FIELDS.filter(f => f.group === g).map(f => `<button type="button" class="chip" data-k="${f.key}" aria-pressed="${xlsPick.has(f.key)}"${f.required ? " disabled" : ""}>${f.label}</button>`).join("")
  }</div>`).join("");
  const n = $("#x-shown").checked ? shownCustomers().length : customers.length;
  $("#x-hint").textContent = `${n}人 × ${xlsPick.size}項目。項目が少ないときは用紙を何列かに分けて並べるので、1枚にたくさん入ります。`;
  try { localStorage.setItem(XLS_KEY, JSON.stringify([...xlsPick])); } catch (e) {}
}
function openXls() {
  $("#x-all-n").textContent = customers.length;
  $("#x-shown-n").textContent = shownCustomers().length;
  $("#x-err").hidden = true;
  renderXlsFields();
  $("#scrim").hidden = false; $("#xls").hidden = false;
}
function closeXls() { $("#xls").hidden = true; if ($("#sheet").hidden && $("#backup").hidden) $("#scrim").hidden = true; }

// Excel を作る部品(vendor/exceljs.min.js)を、必要になったときだけ読み込む
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  return new Promise((ok, ng) => { const sc = document.createElement("script"); sc.src = "vendor/exceljs.min.js"; sc.onload = ok; sc.onerror = ng; document.head.appendChild(sc); });
}

// セルに入れる値(番号は先頭の0が消えないよう、文字として入れる)
function cellValue(c, f) {
  const v = c[f.key];
  if (f.type === "count") return v || 0;
  if (!v) return "";
  if (f.type === "ym") return v.replace("-", "/") + (monthsLeft(v) < 0 ? " ※切れ" : "");
  if (f.type === "date") return v.replace(/-/g, "/");
  return String(v);
}
// 文字の見た目の幅(全角は2、半角は1)
const textWidth = s => [...String(s)].reduce((n, ch) => n + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);

async function buildWorkbook(list, fields) {
  await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = "お届け先メモ";
  const thin = { style: "thin", color: { argb: "FF8C96A0" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const headFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9DEE5" } };
  const zebraFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F5F8" } };
  const overFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD6D1" } };
  const soonFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0C2" } };

  // 列の幅(中身に合わせる。長すぎるものは上限で止めて、文字を縮めて収める)
  const widths = fields.map(f => {
    const w = Math.max(textWidth(f.label), ...list.map(c => textWidth(cellValue(c, f))), 4) + 2;
    return Math.min(w, f.max || 22);
  });
  const ROW_PT = 16, HEAD_PT = 32;                     // 1行の高さ / 見出し2行分の高さ(ポイント)
  const colPt = w => (w * 7 + 5) * 0.75;               // 列の幅 → ポイント(おおよそ)
  const GAP = 2;                                       // 列のかたまりの間のすき間(列幅)
  const blockPt = widths.reduce((a, w) => a + colPt(w), 0);

  // 縦向き・横向き × 何列に分けるか、のうち、1ページに一番たくさん入る組み合わせを選ぶ
  const pages = [{ orient: "portrait", w: 595 - 58, h: 842 - 80 }, { orient: "landscape", w: 842 - 58, h: 595 - 80 }];
  let best = null;
  for (const pg of pages) for (let k = 1; k <= 4; k++) {
    const total = k * blockPt + (k - 1) * colPt(GAP);
    const scale = Math.min(1, pg.w / total);
    if (k > 1 && scale < 0.75) continue;                // 文字が小さくなりすぎる分け方は使わない
    const rows = Math.max(1, Math.floor(((pg.h / scale) - HEAD_PT) / ROW_PT * 0.96));
    const per = k * rows;
    if (!best || per > best.per || (per === best.per && scale > best.scale)) best = { ...pg, k, scale, rows, per };
  }

  /* --- 1枚目:印刷用 --- */
  const ws = wb.addWorksheet("印刷用");
  const groupsOf = fields.map(f => f.group);
  for (let b = 0; b < best.k; b++) {
    const c0 = b * (fields.length + 1) + 1;            // このかたまりの最初の列
    fields.forEach((f, i) => {
      ws.getColumn(c0 + i).width = widths[i];
      const top = ws.getCell(1, c0 + i), bot = ws.getCell(2, c0 + i);
      if (!f.group) { top.value = f.label; ws.mergeCells(1, c0 + i, 2, c0 + i); }
      else { top.value = f.group; bot.value = f.label; }
    });
    // 同じグループの見出し(メーター など)を横につなげる
    let i = 0;
    while (i < fields.length) {
      let j = i; while (j + 1 < fields.length && groupsOf[j + 1] === groupsOf[i]) j++;
      if (groupsOf[i] && j > i) ws.mergeCells(1, c0 + i, 1, c0 + j);
      i = j + 1;
    }
    for (let r = 1; r <= 2; r++) for (let x = 0; x < fields.length; x++) {
      const cell = ws.getCell(r, c0 + x);
      cell.font = { bold: true, size: 10 }; cell.fill = headFill; cell.border = border;
      cell.alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
    }
    if (b < best.k - 1) ws.getColumn(c0 + fields.length).width = GAP;
  }
  ws.getRow(1).height = HEAD_PT / 2; ws.getRow(2).height = HEAD_PT / 2;

  // お客さんを、ページごとに「1列目を上から下へ → 2列目へ」の順で並べる
  let row = 3;
  for (let start = 0; start < list.length; start += best.per) {
    const chunk = list.slice(start, start + best.per);
    const rowsHere = Math.min(best.rows, Math.ceil(chunk.length / best.k));
    for (let r = 0; r < rowsHere; r++) {
      ws.getRow(row + r).height = ROW_PT;
      for (let b = 0; b < best.k; b++) {
        const c = chunk[b * rowsHere + r]; if (!c) continue;
        const c0 = b * (fields.length + 1) + 1;
        fields.forEach((f, i) => {
          const cell = ws.getCell(row + r, c0 + i);
          cell.value = cellValue(c, f);
          cell.font = { size: 10, bold: f.key === "name" };
          cell.border = border;
          cell.alignment = { vertical: "middle", shrinkToFit: true, horizontal: f.type === "count" ? "right" : "left" };
          if (r % 2 === 1) cell.fill = zebraFill;
          if (f.type === "ym" && c[f.key]) { const left = monthsLeft(c[f.key]); if (left < 0) { cell.fill = overFill; cell.font = { size: 10, bold: true }; } else if (left <= EXPIRY_SOON_MONTHS) cell.fill = soonFill; }
        });
      }
    }
    row += rowsHere;
    if (start + best.per < list.length) ws.getRow(row - 1).addPageBreak();
  }
  ws.pageSetup = {
    paperSize: 9, orientation: best.orient, scale: Math.max(10, Math.floor(best.scale * 100)),
    horizontalCentered: true, printTitlesRow: "1:2",
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.5, header: 0.25, footer: 0.25 },
  };
  ws.headerFooter = { oddHeader: `&L&10お客さん一覧&R&10${today().replace(/-/g, "/")}　${list.length}人`, oddFooter: "&C&10&P / &N ページ" };

  /* --- 2枚目:データ(1行1人。Excel で並べ替えや絞り込みに使う) --- */
  const ds = wb.addWorksheet("データ", { views: [{ state: "frozen", ySplit: 1 }] });
  ds.addRow(fields.map(f => (f.group ? f.group + " " : "") + f.label));
  list.forEach(c => ds.addRow(fields.map(f => cellValue(c, f))));
  ds.getRow(1).font = { bold: true };
  fields.forEach((f, i) => { ds.getColumn(i + 1).width = Math.max(widths[i], textWidth(ds.getCell(1, i + 1).value) + 2); });
  ds.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fields.length } };
  // データのシートを印刷したときも、用紙の幅に収める
  ds.pageSetup = { paperSize: 9, orientation: fields.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1",
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 } };
  ds.headerFooter = { oddFooter: "&C&10&P / &N ページ" };
  wb.views = [{ activeTab: 0 }];             // 開いたときは「印刷用」のシートを表示

  return { buffer: await wb.xlsx.writeBuffer(), layout: best };
}

async function makeXlsx() {
  const list = $("#x-shown").checked ? shownCustomers() : customers.slice().sort(byAddr);
  const fields = FIELDS.filter(f => xlsPick.has(f.key));
  if (!list.length) { $("#x-err").textContent = "載せるお客さんがいません。「全員」を選ぶか、検索を変えてください。"; $("#x-err").hidden = false; return; }
  $("#x-make").disabled = true; $("#x-make").textContent = "作っています…";
  try {
    const { buffer, layout } = await buildWorkbook(list, fields);
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `otodoke-list_${today()}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    closeXls();
    toast(`${list.length}人分を書き出しました(1ページ最大${layout.per}人)`);
  } catch (e) {
    $("#x-err").textContent = "Excel ファイルを作れませんでした。一度アプリを開き直してから、もう一度お試しください。";
    $("#x-err").hidden = false;
  } finally { $("#x-make").disabled = false; $("#x-make").textContent = "Excel ファイルを作る"; }
}

/* ===== 3. 画面を作る ===== */
// このお客さんが、検索語と絞り込みに当てはまるか調べる
function matches(c, q) {
  if (filter === "todo" && c.lastDelivered === today()) return false;
  if (filter === "done" && c.lastDelivered !== today()) return false;
  if (!q) return true;
  // 名前・住所・メーター・ボンベのどの項目でも探せる
  const hay = [c.name, c.address, c.meterMaker, c.meterModel, c.regMaker, c.regModel, c.regType, c.cylNo, c.capacity, c.cylCount].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every(t => hay.includes(t));
}

function renderFilters() {
  const opts = [["all", "すべて"], ["todo", "今日まだ"], ["done", "今日完了"]];
  $("#filters").innerHTML = opts.map(([k, l]) => `<button class="chip" data-f="${esc(k)}" aria-pressed="${filter === k}">${esc(l)}</button>`).join("");
}

// 写真がない人に出す、家の形の印
const HOUSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/></svg>`;

// 一覧の1行(写真・名前・住所)。押すと詳細画面が開く
function row(c) {
  const done = c.lastDelivered === today();
  const t = c.photoId && photoURLs[c.photoId]?.thumb;
  return `<button type="button" class="row${done ? " done" : ""}" data-id="${esc(c.id)}">
    <span class="thumb">${t ? `<img src="${t}" alt="">` : HOUSE_ICON}</span>
    <span class="row-text">
      <span class="name">${esc(c.name)}</span>
      ${c.address ? `<span class="addr">${esc(c.address)}</span>` : ""}
    </span>
    ${done ? `<span class="status ok">今日完了</span>` : ""}
    <span class="chev" aria-hidden="true">›</span>
  </button>`;
}

// 詳細画面の1項目(未入力なら「未入力」)
function specRow(label, value, isNum) {
  return `<dt>${label}</dt><dd class="${value ? (isNum ? "num" : "") : "none"}">${value ? esc(value) : "未入力"}</dd>`;
}

// 期限の1項目。過ぎていたら赤、近づいていたら黄色の印を付ける
function expiryRow(value) {
  if (!value) return specRow("期限", "");
  const left = monthsLeft(value);
  const badge = left < 0 ? `<span class="exp over">期限切れ</span>`
    : left === 0 ? `<span class="exp soon">今月まで</span>`
    : left <= EXPIRY_SOON_MONTHS ? `<span class="exp soon">あと${left}か月</span>` : "";
  return `<dt>期限</dt><dd class="num">${fmtYM(value)}${badge}</dd>`;
}

// 詳細画面の中身を組み立てる
function detailHTML(c) {
  const done = c.lastDelivered === today();
  const ago = daysAgo(c.lastDelivered);
  const mapQ = encodeURIComponent(c.address || "");
  return `<header class="d-bar">
      <button type="button" class="d-back" data-act="back">‹ 一覧</button>
      <button type="button" class="d-edit" data-act="edit">編集</button>
    </header>
    <div class="d-body">
      ${c.photoId ? (photoURLs[c.photoId]?.full
        ? `<button type="button" class="d-photo" data-act="photo" aria-label="写真を大きく表示"><img src="${photoURLs[c.photoId].full}" alt="建物の写真"></button>`
        : `<div class="d-photo loading">写真を読み込んでいます…</div>`) : ""}
      <div class="d-head">
        <h2 class="d-name">${esc(c.name)}</h2>
        ${c.address ? `<p class="d-addr">${esc(c.address)}</p>` : `<p class="d-addr none">住所 未入力</p>`}
        ${c.address ? `<a class="d-map" href="https://www.google.com/maps/search/?api=1&query=${mapQ}" target="_blank" rel="noopener">地図で開く</a>` : ""}
      </div>
      <section class="spec"><h3>メーター</h3><dl>
        ${specRow("会社名", c.meterMaker)}${specRow("型式", c.meterModel, true)}${specRow("ピッチ", c.meterPitch, true)}${expiryRow(c.meterExpiry)}
      </dl></section>
      <section class="spec"><h3>調整器</h3><dl>
        ${specRow("会社名", c.regMaker)}${specRow("型式", c.regModel, true)}${specRow("型", c.regType)}${expiryRow(c.regExpiry)}
      </dl></section>
      <section class="spec"><h3>ボンベ</h3><dl>
        ${specRow("番号", c.cylNo, true)}${specRow("容量", c.capacity, true)}${specRow("本数", c.cylCount, true)}
      </dl></section>
      <div class="meta">
        <span>前回配達 <b>${fmtDate(c.lastDelivered)}</b>${ago != null && ago > 0 ? `(${ago}日前)` : ""}</span>
        <span class="absent">不在 <b>${c.absent || 0}</b>回</span>
        ${done ? `<span class="status ok">今日完了</span>` : ""}
      </div>
      <div class="d-actions">
        <button type="button" class="btn primary" data-act="done">✓ 配達完了</button>
        <button type="button" class="btn ghost" data-act="absent">不在</button>
      </div>
    </div>`;
}

// 詳細画面を開く・閉じる
function openDetail(id) {
  detailId = id;
  renderDetail();
  $("#detail").hidden = false;
  $("#detail").scrollTop = 0;
  document.body.classList.add("noscroll");
  // スマホの「戻る」操作で詳細画面が閉じるようにする
  try { history.pushState({ detail: id }, ""); } catch (e) {}
}
function closeDetail(fromBack) {
  if ($("#detail").hidden) return;
  $("#detail").hidden = true;
  detailId = null;
  document.body.classList.remove("noscroll");
  if (!fromBack) { try { history.back(); } catch (e) {} }
}
// データが変わったら詳細画面も描き直す(削除されていたら閉じる)
function renderDetail() {
  if (!detailId) return;
  const c = customers.find(x => x.id === detailId);
  if (!c) return closeDetail();
  $("#detail").innerHTML = detailHTML(c);
  // 大きな写真がまだ読み込まれていなければ、読み込んでから描き直す
  if (c.photoId && !photoURLs[c.photoId]?.full) photoURL(c.photoId, "full").then(u => { if (u && detailId === c.id) renderDetail(); }).catch(() => {});
}

// 一覧全体を描き直す(データが変わるたびに呼ばれる)
function render() {
  renderFilters();
  const q = $("#q").value.trim();
  $("#qclear").hidden = !q;
  const t = today();
  const doneN = customers.filter(c => c.lastDelivered === t).length;
  $("#stats").innerHTML = mode === "loading" ? "読み込み中…" : `登録 <b>${customers.length}</b>件 · 今日完了 <b>${doneN}</b>件`;
  // 一度入力したメーターの会社名を、入力画面の候補にする
  const opts = key => [...new Set(customers.map(c => c[key]).filter(Boolean))].map(a => `<option value="${esc(a)}">`).join("");
  $("#makers").innerHTML = opts("meterMaker");
  $("#regmakers").innerHTML = opts("regMaker");

  renderDetail();
  if (mode === "loading") { $("#list").innerHTML = `<div class="empty"><strong>読み込み中…</strong></div>`; return; }
  if (!customers.length) {
    $("#list").innerHTML = `<div class="empty"><strong>まだお届け先がありません</strong><span>右下の「追加」から、お客さんの住所とメーター・ボンベの情報を登録しましょう。</span></div>`;
    return;
  }
  const shown = customers.filter(c => matches(c, q));
  if (!shown.length) { $("#list").innerHTML = `<div class="empty"><strong>見つかりませんでした</strong><span>検索語や絞り込みを変えてみてください。</span></div>`; return; }

  // 住所の順に並べる
  $("#list").innerHTML = `<section class="area"><h2>お客さん　${shown.length}件</h2><div class="list">${shown.sort(byAddr).map(row).join("")}</div></section>`;
}

/* ===== 4. ボタンを押したときの動き ===== */
// 画面下にお知らせを5秒間出す
function toast(msg, undo) {
  $("#toast-msg").textContent = msg;
  undoFn = undo || null;
  $("#toast-undo").hidden = !undo;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").hidden = true; undoFn = null; }, 5000);
}
$("#toast-undo").addEventListener("click", async () => { const f = undoFn; $("#toast").hidden = true; undoFn = null; if (f) await f(); });

// カードの「完了」「不在」「編集」ボタン
// 一覧の名前を押したら、詳細画面を開く
$("#list").addEventListener("click", e => {
  const r = e.target.closest(".row[data-id]"); if (r) openDetail(r.dataset.id);
});

// 詳細画面のボタン(一覧に戻る・編集・配達完了・不在)
$("#detail").addEventListener("click", async e => {
  const btn = e.target.closest("button[data-act]"); if (!btn) return;
  if (btn.dataset.act === "back") return closeDetail();
  if (btn.dataset.act === "photo") { $("#viewer-img").src = btn.querySelector("img").src; $("#viewer").hidden = false; return; }
  const c = customers.find(x => x.id === detailId); if (!c) return;
  const before = { ...c };
  if (btn.dataset.act === "edit") return openSheet(c);
  if (btn.dataset.act === "done") {
    await writeDoc({ ...c, lastDelivered: today() });
    toast(`${c.name}さん 配達完了`, () => writeDoc(before));
  }
  if (btn.dataset.act === "absent") {
    await writeDoc({ ...c, absent: (c.absent || 0) + 1, lastAbsent: today() });
    toast(`${c.name}さん 不在を記録（${(c.absent || 0) + 1}回目）`, () => writeDoc(before));
  }
});
// 大きな写真を押したら閉じる
$("#viewer").addEventListener("click", () => { $("#viewer").hidden = true; });

// スマホの「戻る」操作をしたとき
window.addEventListener("popstate", () => {
  if (!$("#viewer").hidden) { $("#viewer").hidden = true; if (detailId) { try { history.pushState({ detail: detailId }, ""); } catch (e) {} } return; }
  // 入力画面やバックアップ画面が開いていたら、それだけを閉じる
  if (!$("#sheet").hidden || !$("#backup").hidden || !$("#xls").hidden) {
    closeSheet(); closeBackup(); closeXls();
    if (detailId) { try { history.pushState({ detail: detailId }, ""); } catch (e) {} }
    return;
  }
  closeDetail(true);
});

// 絞り込みボタンと検索欄
$("#filters").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; filter = b.dataset.f; render(); });
$("#q").addEventListener("input", render);
$("#qclear").addEventListener("click", () => { $("#q").value = ""; render(); $("#q").focus(); });

/* ===== 5. 追加・編集画面 ===== */
let delArmed = false;
// 入力画面で写真をどうするか:undefined=変えない / null=外す / {full, thumb, url}=新しい写真
let pendingPhoto;

// 入力画面の写真の表示を更新する
function showFormPhoto(url) {
  $("#f-photo-img").hidden = !url; if (url) $("#f-photo-img").src = url;
  $("#f-photo-empty").hidden = !!url;
  $("#f-photo-box").classList.toggle("has", !!url);
  $("#f-photo-del").hidden = !url;
  $("#f-photo-pick").textContent = url ? "写真を撮り直す・選び直す" : "写真を撮る・選ぶ";
}
// 写真を撮った・選んだとき
$("#f-photo").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  $("#f-photo-empty").textContent = "準備しています…"; $("#f-photo-empty").hidden = false; $("#f-photo-img").hidden = true;
  try {
    const ph = await makePhoto(file);
    if (pendingPhoto?.url) URL.revokeObjectURL(pendingPhoto.url);
    pendingPhoto = { ...ph, url: URL.createObjectURL(ph.full) };
    showFormPhoto(pendingPhoto.url);
  } catch (err) {
    $("#f-err").textContent = "この写真は使えませんでした。別の写真を選ぶか、撮り直してください。"; $("#f-err").hidden = false;
    showFormPhoto(null);
  } finally { $("#f-photo-empty").textContent = "写真なし"; }
});
// 写真を外す
$("#f-photo-del").addEventListener("click", () => { pendingPhoto = null; showFormPhoto(null); });


// 入力画面を開く(c があれば編集、なければ新規追加)
function openSheet(c) {
  editingId = c ? c.id : null;
  $("#sheet-title").textContent = c ? "お届け先を編集" : "お届け先を追加";
  $("#f-name").value = c?.name || "";
  $("#f-addr").value = c?.address || "";
  $("#f-maker").value = c?.meterMaker || "";
  $("#f-model").value = c?.meterModel || "";
  $("#f-pitch").value = c?.meterPitch || "";
  $("#f-meterexp").value = c?.meterExpiry || "";
  $("#f-regmaker").value = c?.regMaker || "";
  $("#f-regmodel").value = c?.regModel || "";
  $("#f-regtype").value = c?.regType || "";
  $("#f-regexp").value = c?.regExpiry || "";
  $("#f-cyl").value = c?.cylNo || "";
  // 以前に選択肢以外の容量(30kg など)が入っていた人は、消えないようにその値も選べるようにしておく
  $("#f-cap").querySelectorAll("option.old").forEach(o => o.remove());
  if (c?.capacity && ![...$("#f-cap").options].some(o => o.value === c.capacity)) {
    $("#f-cap").insertAdjacentHTML("beforeend", `<option class="old" value="${esc(c.capacity)}">${esc(c.capacity)}(以前の値)</option>`);
  }
  $("#f-cap").value = c?.capacity || "";
  $("#f-cylcount").value = c?.cylCount || "";
  pendingPhoto = undefined;
  showFormPhoto(null);
  if (c?.photoId) photoURL(c.photoId, "full").then(u => { if (pendingPhoto === undefined && editingId === c.id) showFormPhoto(u); }).catch(() => {});
  $("#f-err").hidden = true;
  $("#f-delwrap").hidden = !c;
  delArmed = false; $("#f-del").textContent = "このお届け先を削除";
  $("#scrim").hidden = false; $("#sheet").hidden = false;
  setTimeout(() => $("#f-name").focus(), 50);
}
function closeSheet() { $("#scrim").hidden = true; $("#sheet").hidden = true; editingId = null; }

// Excel 書き出し画面のボタン
$("#xls-open").addEventListener("click", openXls);
$("#x-close").addEventListener("click", closeXls);
$("#x-make").addEventListener("click", makeXlsx);
$("#x-all").addEventListener("change", renderXlsFields);
$("#x-shown").addEventListener("change", renderXlsFields);
$("#x-fields").addEventListener("click", e => {
  const b = e.target.closest(".chip[data-k]"); if (!b || b.disabled) return;
  const k = b.dataset.k; xlsPick.has(k) ? xlsPick.delete(k) : xlsPick.add(k); renderXlsFields();
});
$("#x-all-fields").addEventListener("click", () => { xlsPick = new Set(FIELDS.map(f => f.key)); renderXlsFields(); });
$("#x-min-fields").addEventListener("click", () => { xlsPick = new Set(["name"]); renderXlsFields(); });

// バックアップ画面のボタン
$("#menu").addEventListener("click", openBackup);
$("#b-close").addEventListener("click", closeBackup);
$("#b-export").addEventListener("click", exportBackup);
$("#b-import").addEventListener("change", e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ""; });
$("#add").addEventListener("click", () => openSheet(null));
$("#f-cancel").addEventListener("click", closeSheet);
$("#scrim").addEventListener("click", () => { closeSheet(); closeBackup(); closeXls(); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("#viewer").hidden) { $("#viewer").hidden = true; return; }
  if (!$("#sheet").hidden) return closeSheet();
  if (!$("#backup").hidden) return closeBackup();
  if (!$("#xls").hidden) return closeXls();
  closeDetail();
});

// 「保存する」を押したとき
$("#form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("#f-name").value.trim();
  if (!name) { $("#f-err").textContent = "お客さんの名前を入力してください。名字だけでも大丈夫です。"; $("#f-err").hidden = false; return; }
  const meterExpiry = normYM($("#f-meterexp").value), regExpiry = normYM($("#f-regexp").value);
  if (meterExpiry === null || regExpiry === null) { $("#f-err").textContent = "期限は「2031-03」のように、年と月で入力してください。"; $("#f-err").hidden = false; return; }
  const old = editingId ? customers.find(x => x.id === editingId) : null;
  const c = {
    ...(old || { absent: 0, lastDelivered: "" }),
    id: editingId || newId(),
    name,
    address: $("#f-addr").value.trim(),
    meterMaker: $("#f-maker").value.trim(),
    meterModel: $("#f-model").value.trim(),
    meterPitch: $("#f-pitch").value,
    meterExpiry,
    regMaker: $("#f-regmaker").value.trim(),
    regModel: $("#f-regmodel").value.trim(),
    regType: $("#f-regtype").value,
    regExpiry,
    cylNo: $("#f-cyl").value.trim(),
    capacity: $("#f-cap").value,
    cylCount: $("#f-cylcount").value,
  };
  $("#f-save").disabled = true;
  try {
    // 新しい写真は、新しい名前で保存する(古い写真は「元に戻す」に備えて、次に起動したときに片付ける)
    if (pendingPhoto) {
      const pid = "p" + newId();
      await putPhoto(pid, { full: pendingPhoto.full, thumb: pendingPhoto.thumb });
      photoURLs[pid] = { full: pendingPhoto.url, thumb: URL.createObjectURL(pendingPhoto.thumb) };
      c.photoId = pid; pendingPhoto = undefined;
    } else if (pendingPhoto === null) c.photoId = "";
    await writeDoc(c); closeSheet();
    // 5秒以内なら「元に戻す」で取り消せる(編集→編集前に戻す/追加→追加を取り消す)
    if (old) toast(`${name}さんの情報を変更しました`, () => writeDoc(old));
    else toast(`${name}さんを追加しました`, () => removeDoc(c.id));
  }
  catch (err) { $("#f-err").textContent = "保存できませんでした。端末の空き容量を確認して、もう一度「保存する」を押してください。"; $("#f-err").hidden = false; }
  finally { $("#f-save").disabled = false; }
});

// 削除ボタン(押し間違い防止のため2回押しで削除)
$("#f-del").addEventListener("click", async () => {
  if (!delArmed) { delArmed = true; $("#f-del").textContent = "もう一度押すと削除します"; return; }
  const c = customers.find(x => x.id === editingId);
  if (!c) return closeSheet();
  await removeDoc(c.id);
  closeSheet();
  toast(`${c.name}さんを削除しました`, () => writeDoc(c));
});

// アプリを起動する
init();

// オフラインでも開けるように、アプリ本体を端末に保存する係(sw.js)を登録する
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
