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

// メーター番号の最大文字数
const METER_NO_MAX = 10;
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
  { id: "ex1", name: "（例）田中", address: "岩村田1234", meterMaker: "（例）サンプル計器", meterModel: "NB4-X", meterNo: "A123456789", cylNo: "C-20481", capacity: "50kg", absent: 0, lastDelivered: "" },
  { id: "ex2", name: "（例）佐藤", address: "岩村田2051", meterMaker: "（例）サンプル計器", meterModel: "NB6-Y", meterNo: "0987654", cylNo: "C-11730", capacity: "20kg", absent: 0, lastDelivered: "" },
];

// アプリ起動時の処理:端末の中からデータを読み込む
async function init() {
  const saved = loadLocal();
  if (saved === null) { customers = EXAMPLES.map(x => ({ ...x })); saveLocal(); }
  else customers = saved;
  mode = "local";
  render();
  // 端末の容量が少なくなっても、勝手に消されないようにお願いする
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
}

/* ===== 2-2. バックアップ(機種変更・端末の間の引っ越し用) ===== */
// 全データを1つのファイルに書き出す
function exportBackup() {
  const json = JSON.stringify({ app: "otodoke-memo", version: 1, exportedAt: new Date().toISOString(), customers }, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `otodoke-memo_${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  try { localStorage.setItem(LS_KEY + "-lastBackup", today()); } catch (e) {}
  renderBackupInfo();
  toast(`${customers.length}件を書き出しました`);
}
// 書き出したファイルを読み込んで、データを置き換える
async function importBackup(file) {
  try {
    const obj = JSON.parse(await file.text());
    if (!obj || obj.app !== "otodoke-memo" || !Array.isArray(obj.customers)) throw new Error("bad");
    const before = customers;
    customers = obj.customers;
    saveLocal(); render(); closeBackup();
    toast(`${customers.length}件を読み込みました`, () => { customers = before; saveLocal(); render(); });
  } catch (e) {
    $("#b-err").textContent = "このファイルは読み込めません。お届け先メモで書き出したファイル(.json)を選んでください。";
    $("#b-err").hidden = false;
  }
}
function renderBackupInfo() {
  let last = null; try { last = localStorage.getItem(LS_KEY + "-lastBackup"); } catch (e) {}
  $("#b-info").textContent = `この端末に ${customers.length}件 保存されています。前回の書き出し:${last ? fmtDate(last) : "まだありません"}`;
}
function openBackup() { renderBackupInfo(); $("#b-err").hidden = true; $("#scrim").hidden = false; $("#backup").hidden = false; }
function closeBackup() { $("#backup").hidden = true; if ($("#sheet").hidden) $("#scrim").hidden = true; }

/* ===== 3. 画面を作る ===== */
// このお客さんが、検索語と絞り込みに当てはまるか調べる
function matches(c, q) {
  if (filter === "todo" && c.lastDelivered === today()) return false;
  if (filter === "done" && c.lastDelivered !== today()) return false;
  if (!q) return true;
  // 名前・住所・メーター・ボンベのどの項目でも探せる
  const hay = [c.name, c.address, c.meterMaker, c.meterModel, c.meterNo, c.cylNo, c.capacity].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every(t => hay.includes(t));
}

function renderFilters() {
  const opts = [["all", "すべて"], ["todo", "今日まだ"], ["done", "今日完了"]];
  $("#filters").innerHTML = opts.map(([k, l]) => `<button class="chip" data-f="${esc(k)}" aria-pressed="${filter === k}">${esc(l)}</button>`).join("");
}

// 一覧の1行(名前と住所だけ)。押すと詳細画面が開く
function row(c) {
  const done = c.lastDelivered === today();
  return `<button type="button" class="row${done ? " done" : ""}" data-id="${esc(c.id)}">
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
      <div class="d-head">
        <h2 class="d-name">${esc(c.name)}</h2>
        ${c.address ? `<p class="d-addr">${esc(c.address)}</p>` : `<p class="d-addr none">住所 未入力</p>`}
        ${c.address ? `<a class="d-map" href="https://www.google.com/maps/search/?api=1&query=${mapQ}" target="_blank" rel="noopener">地図で開く</a>` : ""}
      </div>
      <section class="spec"><h3>メーター</h3><dl>
        ${specRow("会社名", c.meterMaker)}${specRow("品番", c.meterModel, true)}${specRow("番号", c.meterNo, true)}
      </dl></section>
      <section class="spec"><h3>ボンベ</h3><dl>
        ${specRow("番号", c.cylNo, true)}${specRow("容量", c.capacity, true)}
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
  $("#makers").innerHTML = [...new Set(customers.map(c => c.meterMaker).filter(Boolean))].map(a => `<option value="${esc(a)}">`).join("");

  renderDetail();
  if (mode === "loading") { $("#list").innerHTML = `<div class="empty"><strong>読み込み中…</strong></div>`; return; }
  if (!customers.length) {
    $("#list").innerHTML = `<div class="empty"><strong>まだお届け先がありません</strong><span>右下の「追加」から、お客さんの住所とメーター・ボンベの情報を登録しましょう。</span></div>`;
    return;
  }
  const shown = customers.filter(c => matches(c, q));
  if (!shown.length) { $("#list").innerHTML = `<div class="empty"><strong>見つかりませんでした</strong><span>検索語や絞り込みを変えてみてください。</span></div>`; return; }

  // 住所の順に並べる
  const byAddr = (a, b) => (a.address || "").localeCompare(b.address || "", "ja", { numeric: true }) || (a.name || "").localeCompare(b.name || "", "ja");
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
// スマホの「戻る」操作をしたとき
window.addEventListener("popstate", () => {
  // 入力画面やバックアップ画面が開いていたら、それだけを閉じる
  if (!$("#sheet").hidden || !$("#backup").hidden) {
    closeSheet(); closeBackup();
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

// メーター番号の文字数を「3/10」のように表示する
function updateMeterCount() {
  const n = [...$("#f-meterno").value].length;
  $("#f-meterno-count").textContent = `${n}/${METER_NO_MAX}`;
  $("#f-meterno-count").classList.toggle("full", n >= METER_NO_MAX);
}
$("#f-meterno").addEventListener("input", updateMeterCount);

// 入力画面を開く(c があれば編集、なければ新規追加)
function openSheet(c) {
  editingId = c ? c.id : null;
  $("#sheet-title").textContent = c ? "お届け先を編集" : "お届け先を追加";
  $("#f-name").value = c?.name || "";
  $("#f-addr").value = c?.address || "";
  $("#f-maker").value = c?.meterMaker || "";
  $("#f-model").value = c?.meterModel || "";
  $("#f-meterno").value = c?.meterNo || "";
  $("#f-cyl").value = c?.cylNo || "";
  $("#f-cap").value = c?.capacity || "";
  updateMeterCount();
  $("#f-err").hidden = true;
  $("#f-delwrap").hidden = !c;
  delArmed = false; $("#f-del").textContent = "このお届け先を削除";
  $("#scrim").hidden = false; $("#sheet").hidden = false;
  setTimeout(() => $("#f-name").focus(), 50);
}
function closeSheet() { $("#scrim").hidden = true; $("#sheet").hidden = true; editingId = null; }

// バックアップ画面のボタン
$("#menu").addEventListener("click", openBackup);
$("#b-close").addEventListener("click", closeBackup);
$("#b-export").addEventListener("click", exportBackup);
$("#b-import").addEventListener("change", e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ""; });
$("#add").addEventListener("click", () => openSheet(null));
$("#f-cancel").addEventListener("click", closeSheet);
$("#scrim").addEventListener("click", () => { closeSheet(); closeBackup(); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("#sheet").hidden) return closeSheet();
  if (!$("#backup").hidden) return closeBackup();
  closeDetail();
});

// 「保存する」を押したとき
$("#form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("#f-name").value.trim();
  if (!name) { $("#f-err").textContent = "お客さんの名前を入力してください。名字だけでも大丈夫です。"; $("#f-err").hidden = false; return; }
  const meterNo = $("#f-meterno").value.trim();
  if ([...meterNo].length > METER_NO_MAX) { $("#f-err").textContent = `メーターの番号は${METER_NO_MAX}字以内で入力してください。`; $("#f-err").hidden = false; return; }
  const old = editingId ? customers.find(x => x.id === editingId) : null;
  const c = {
    ...(old || { absent: 0, lastDelivered: "" }),
    id: editingId || newId(),
    name,
    address: $("#f-addr").value.trim(),
    meterMaker: $("#f-maker").value.trim(),
    meterModel: $("#f-model").value.trim(),
    meterNo: meterNo,
    cylNo: $("#f-cyl").value.trim(),
    capacity: $("#f-cap").value.trim(),
  };
  $("#f-save").disabled = true;
  try {
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
