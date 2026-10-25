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

// 選べる特徴タグの一覧
const TAGS = ["置き配OK", "宅配ボックス", "不在が多い", "犬・ペット注意", "時間指定あり", "要サイン", "階段のみ", "インターホン故障"];
// このうち、赤で目立たせる注意タグ
const WARN = new Set(["不在が多い", "犬・ペット注意", "要サイン", "インターホン故障"]);
const LS_KEY = "otodoke-memo-v1";

// アプリが今覚えている情報
let customers = [];      // {id, ...data}
let mode = "loading";    // "local"(読み込み完了)| "loading"
let filter = "all";
let editingId = null;
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
  { id: "ex1", name: "（例）田中", area: "岩村田", room: "203", address: "岩村田1234 グリーンハイツ", place: "玄関横の青い宅配ボックス", tags: ["宅配ボックス", "不在が多い"], memo: "平日は18時以降なら在宅が多い。", phone: "", absent: 3, lastDelivered: "" },
  { id: "ex2", name: "（例）佐藤", area: "岩村田", room: "", address: "岩村田2051 一軒家（赤い屋根）", place: "置き配OK：勝手口の屋根下", tags: ["置き配OK", "犬・ペット注意"], memo: "大型犬がいるが繋がれている。", phone: "", absent: 0, lastDelivered: "" },
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
  if (TAGS.includes(filter) && !(c.tags || []).includes(filter)) return false;
  if (!q) return true;
  const hay = [c.name, c.area, c.address, c.room, c.place, c.memo, (c.tags || []).join(" "), c.phone].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every(t => hay.includes(t));
}

function renderFilters() {
  const opts = [["all", "すべて"], ["todo", "今日まだ"], ["done", "今日完了"], ...TAGS.map(t => [t, t])];
  $("#filters").innerHTML = opts.map(([k, l]) => `<button class="chip" data-f="${esc(k)}" aria-pressed="${filter === k}">${esc(l)}</button>`).join("");
}

// お客さん1人分のカードのHTMLを組み立てる
function card(c) {
  const done = c.lastDelivered === today();
  const tags = (c.tags || []).map(t => `<span class="tag${WARN.has(t) ? " warn" : ""}">${esc(t)}</span>`).join("");
  const ago = daysAgo(c.lastDelivered);
  const mapQ = encodeURIComponent([c.address, c.area].filter(Boolean).join(" "));
  return `<article class="card${done ? " done" : ""}" data-id="${esc(c.id)}">
    <div class="card-main">
      <div class="row1">
        ${c.room ? `<span class="room">${esc(c.room)}</span>` : ""}
        <span class="name">${esc(c.name)}</span>
        ${done ? `<span class="status ok">今日完了</span>` : ""}
      </div>
      ${c.address ? `<div class="addr">${esc(c.address)}</div>` : ""}
      ${c.place ? `<div class="place"><span class="k">置き場所</span><span>${esc(c.place)}</span></div>` : ""}
      ${tags ? `<div class="tags">${tags}</div>` : ""}
      ${c.memo ? `<div class="memo">${esc(c.memo)}</div>` : ""}
      <div class="meta">
        <span>前回配達 <b>${fmtDate(c.lastDelivered)}</b>${ago != null && ago > 0 ? `（${ago}日前）` : ""}</span>
        <span class="absent">不在 <b>${c.absent || 0}</b>回</span>
        ${c.phone ? `<span>☎ <span class="phone">${esc(c.phone)}</span></span>` : ""}
      </div>
    </div>
    <div class="actions">
      <button class="act-done" data-act="done">✓ 完了</button>
      <button class="act-absent" data-act="absent">不在</button>
      ${mapQ ? `<a href="https://www.google.com/maps/search/?api=1&query=${mapQ}" target="_blank" rel="noopener">地図</a>` : `<button disabled>地図</button>`}
      <button data-act="edit">編集</button>
    </div>
  </article>`;
}

// 一覧全体を描き直す(データが変わるたびに呼ばれる)
function render() {
  renderFilters();
  const q = $("#q").value.trim();
  $("#qclear").hidden = !q;
  const t = today();
  const doneN = customers.filter(c => c.lastDelivered === t).length;
  $("#stats").innerHTML = mode === "loading" ? "読み込み中…" : `登録 <b>${customers.length}</b>件 · 今日完了 <b>${doneN}</b>件`;
  $("#areas").innerHTML = [...new Set(customers.map(c => c.area).filter(Boolean))].map(a => `<option value="${esc(a)}">`).join("");

  if (mode === "loading") { $("#list").innerHTML = `<div class="empty"><strong>読み込み中…</strong></div>`; return; }
  if (!customers.length) {
    $("#list").innerHTML = `<div class="empty"><strong>まだお届け先がありません</strong><span>右下の「追加」から、よく行くお宅の置き場所や注意点を登録しましょう。</span></div>`;
    return;
  }
  const shown = customers.filter(c => matches(c, q));
  if (!shown.length) { $("#list").innerHTML = `<div class="empty"><strong>見つかりませんでした</strong><span>検索語や絞り込みを変えてみてください。</span></div>`; return; }

  const groups = {};
  shown.forEach(c => { (groups[c.area || "エリア未設定"] ||= []).push(c); });
  const sortRoom = (a, b) => (a.address || "").localeCompare(b.address || "", "ja") || (a.room || "").localeCompare(b.room || "", "ja", { numeric: true }) || (a.name || "").localeCompare(b.name || "", "ja");
  $("#list").innerHTML = Object.keys(groups).sort((a, b) => a === "エリア未設定" ? 1 : b === "エリア未設定" ? -1 : a.localeCompare(b, "ja")).map(a =>
    `<section class="area"><h2>${esc(a)}　${groups[a].length}件</h2><div class="list">${groups[a].sort(sortRoom).map(card).join("")}</div></section>`
  ).join("");
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
$("#list").addEventListener("click", async e => {
  const btn = e.target.closest("button[data-act]"); if (!btn) return;
  const id = btn.closest(".card").dataset.id;
  const c = customers.find(x => x.id === id); if (!c) return;
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

// 絞り込みボタンと検索欄
$("#filters").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; filter = b.dataset.f; render(); });
$("#q").addEventListener("input", render);
$("#qclear").addEventListener("click", () => { $("#q").value = ""; render(); $("#q").focus(); });

/* ===== 5. 追加・編集画面 ===== */
let pickTags = new Set();
let delArmed = false;
function renderTagPick() {
  $("#f-tags").innerHTML = TAGS.map(t => `<button type="button" class="chip" data-t="${esc(t)}" aria-pressed="${pickTags.has(t)}">${esc(t)}</button>`).join("");
}
$("#f-tags").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; const t = b.dataset.t; pickTags.has(t) ? pickTags.delete(t) : pickTags.add(t); renderTagPick(); });

// 入力画面を開く(c があれば編集、なければ新規追加)
function openSheet(c) {
  editingId = c ? c.id : null;
  $("#sheet-title").textContent = c ? "お届け先を編集" : "お届け先を追加";
  $("#f-name").value = c?.name || "";
  $("#f-area").value = c?.area || (filter === "all" ? "" : "");
  $("#f-room").value = c?.room || "";
  $("#f-addr").value = c?.address || "";
  $("#f-place").value = c?.place || "";
  $("#f-memo").value = c?.memo || "";
  $("#f-phone").value = c?.phone || "";
  pickTags = new Set(c?.tags || []);
  renderTagPick();
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
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#sheet").hidden) closeSheet(); if (!$("#backup").hidden) closeBackup(); } });

// 「保存する」を押したとき
$("#form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("#f-name").value.trim();
  if (!name) { $("#f-err").textContent = "名前を入力してください。表札の名字だけでも大丈夫です。"; $("#f-err").hidden = false; return; }
  const old = editingId ? customers.find(x => x.id === editingId) : null;
  const c = {
    ...(old || { absent: 0, lastDelivered: "" }),
    id: editingId || newId(),
    name,
    area: $("#f-area").value.trim(),
    room: $("#f-room").value.trim(),
    address: $("#f-addr").value.trim(),
    place: $("#f-place").value.trim(),
    memo: $("#f-memo").value.trim(),
    phone: $("#f-phone").value.trim(),
    tags: TAGS.filter(t => pickTags.has(t)),
  };
  $("#f-save").disabled = true;
  try { await writeDoc(c); closeSheet(); toast(old ? "保存しました" : `${name}さんを追加しました`); }
  catch (err) { $("#f-err").textContent = "保存できませんでした。通信状況を確認して、もう一度「保存する」を押してください。"; $("#f-err").hidden = false; }
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
