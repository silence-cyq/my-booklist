const STORAGE_KEY = "chenyanqiu-booklist-v2";
const TEAM_KEY = "chenyanqiu-booklist-team-v1";
const DIRTY_KEY = "chenyanqiu-booklist-dirty-v1";
const REPO = "silence-cyq/my-booklist";
const BRANCH = "main";
const DATA_PATH = "data.json";
const RAW_DATA_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${DATA_PATH}`;
const API_CONTENTS_URL = `https://api.github.com/repos/${REPO}/contents/${DATA_PATH}`;

const seed = JSON.parse(document.getElementById("seedData").textContent);
let themeMap = Object.fromEntries(seed.themes.map(theme => [theme.id, theme]));
let state = loadState();
let team = loadTeam();
let teamMode = Boolean(team.token && team.name);
let filters = { query: "", theme: "all", category: null, status: "all" };
let editingId = null;
let toastTimer = null;
let syncTimer = null;
let syncInFlight = false;
let dirty = localStorage.getItem(DIRTY_KEY) === "1";

const els = {
  search: document.getElementById("searchInput"),
  clearSearch: document.getElementById("clearSearch"),
  content: document.getElementById("content"),
  empty: document.getElementById("emptyState"),
  resultText: document.getElementById("resultText"),
  activeFilter: document.getElementById("activeFilter"),
  sideNav: document.getElementById("sideNav"),
  statTotal: document.getElementById("statTotal"),
  statRead: document.getElementById("statRead"),
  statUnread: document.getElementById("statUnread"),
  statRate: document.getElementById("statRate"),
  modal: document.getElementById("bookModal"),
  modalTitle: document.getElementById("modalTitle"),
  form: document.getElementById("bookForm"),
  title: document.getElementById("bookTitle"),
  author: document.getElementById("bookAuthor"),
  theme: document.getElementById("bookTheme"),
  category: document.getElementById("bookCategory"),
  categoryList: document.getElementById("categoryList"),
  intro: document.getElementById("bookIntro"),
  note: document.getElementById("bookNote"),
  read: document.getElementById("bookRead"),
  deleteBook: document.getElementById("deleteBook"),
  spotlight: document.getElementById("spotlight"),
  importFile: document.getElementById("importFile"),
  toast: document.getElementById("toast"),
  teamModal: document.getElementById("teamModal"),
  teamName: document.getElementById("teamName"),
  teamToken: document.getElementById("teamToken"),
  teamStatus: document.getElementById("teamStatus"),
  syncStatus: document.getElementById("syncStatus")
};

normalizeState();
mergeSeedData();
migrateStructure();
migrateReadStatus();
normalizeState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (error) {
    console.warn(error);
  }
  return JSON.parse(JSON.stringify(seed));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadTeam() {
  try {
    return JSON.parse(localStorage.getItem(TEAM_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function saveTeam() {
  localStorage.setItem(TEAM_KEY, JSON.stringify(team));
}

function currentUser() {
  if (team.name) return team.name;
  return document.body.classList.contains("share-mode") ? "访客" : "陈彦秋";
}

function normalizeState() {
  state.themes = Array.isArray(state.themes) ? state.themes : [];
  state.categories = Array.isArray(state.categories) ? state.categories : [];
  state.books = Array.isArray(state.books) ? state.books : [];
  state.books.forEach(book => {
    if (!book.readBy || typeof book.readBy !== "object" || Array.isArray(book.readBy)) {
      book.readBy = {};
    }
    if (!book.updatedAt) {
      book.updatedAt = book.addedAt ? `${book.addedAt}T00:00:00.000Z` : new Date().toISOString();
    }
    book.deleted = Boolean(book.deleted);
  });
  if (!state.updatedAt) {
    state.updatedAt = state.generatedAt ? `${state.generatedAt}T00:00:00.000Z` : new Date().toISOString();
  }
  refreshThemeMap();
}

function refreshThemeMap() {
  themeMap = Object.fromEntries(state.themes.map(theme => [theme.id, theme]));
}

function normTitle(value) {
  return String(value || "").toLowerCase()
    .replace(/[《》]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\w\u4e00-\u9fff]/g, "");
}

function mergeSeedData() {
  if (state.seedMergeId === seed.mergeId) return;
  const knownIds = new Set(state.books.map(book => book.id));
  const knownTitles = new Set(state.books.map(book => normTitle(book.title)));
  seed.books.forEach(book => {
    if (!knownIds.has(book.id) && !knownTitles.has(normTitle(book.title))) {
      state.books.push({ ...book, readBy: book.readBy || {}, deleted: false });
      knownIds.add(book.id);
      knownTitles.add(normTitle(book.title));
    }
  });
  const knownCategories = new Set(state.categories.map(category => category.id));
  seed.categories.forEach(category => {
    if (!knownCategories.has(category.id)) {
      state.categories.push({ ...category });
      knownCategories.add(category.id);
    }
  });
  state.seedMergeId = seed.mergeId;
  saveState();
}

function migrateStructure() {
  if (state.structureVersion >= 3) return;
  const communication = state.themes.find(theme => theme.id === "communication");
  if (communication) {
    communication.name = "沟通";
    communication.description = "理解表达、关系与职场沟通。";
  }
  if (!state.themes.some(theme => theme.id === "psychology")) {
    const psychology = {
      id: "psychology",
      name: "心理",
      accent: "#a21caf",
      description: "理解心理、情绪与心理咨询。"
    };
    const index = state.themes.findIndex(theme => theme.id === "communication");
    state.themes.splice(index >= 0 ? index + 1 : state.themes.length, 0, psychology);
  }
  state.categories = state.categories.filter(category => category.id !== "communication::心理学");
  const ensureCategory = (id, name, description) => {
    if (state.categories.some(category => category.id === id)) return;
    state.categories.push({ id, theme: "psychology", name, description, isNew: true });
  };
  ensureCategory("psychology::心理学", "心理学", "心理学基础、诊断、人格、成长与情绪调节。");
  ensureCategory("psychology::心理咨询", "心理咨询", "心理咨询执业、流派与技术。");
  state.books.forEach(book => {
    if (book.theme === "communication" && book.category === "心理学") {
      book.theme = "psychology";
    }
  });
  state.structureVersion = 3;
  saveState();
}

function migrateReadStatus() {
  let changed = false;
  state.books.forEach(book => {
    if (!book.readBy || typeof book.readBy !== "object" || Array.isArray(book.readBy)) {
      book.readBy = {};
      changed = true;
    }
    if (book.read === true) {
      book.readBy["陈彦秋"] = true;
      changed = true;
    }
    if ("read" in book) {
      delete book.read;
      changed = true;
    }
  });
  if (changed) saveState();
}

function ensureCategories() {
  state.categories = state.categories.filter(category =>
    state.books.some(book => !book.deleted && book.category === category.name && book.theme === category.theme)
  );
  const known = new Set(state.categories.map(category => category.id));
  state.books.forEach(book => {
    if (book.deleted) return;
    const id = `${book.theme}::${book.category}`;
    if (!known.has(id)) {
      state.categories.push({
        id,
        theme: book.theme,
        name: book.category,
        description: themeMap[book.theme]?.description || "",
        isNew: false
      });
      known.add(id);
    }
  });
  state.categories.sort((a, b) => {
    const themeOrder = state.themes.map(theme => theme.id);
    return themeOrder.indexOf(a.theme) - themeOrder.indexOf(b.theme) || a.name.localeCompare(b.name, "zh-CN");
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function isRead(book) {
  return Boolean(book.readBy && book.readBy[currentUser()]);
}

function setRead(book, value) {
  if (!book.readBy || typeof book.readBy !== "object" || Array.isArray(book.readBy)) {
    book.readBy = {};
  }
  if (value) {
    book.readBy[currentUser()] = true;
  } else {
    delete book.readBy[currentUser()];
  }
}

function filteredBooks() {
  const query = filters.query.trim().toLowerCase();
  return state.books.filter(book => {
    if (book.deleted) return false;
    if (filters.theme !== "all" && book.theme !== filters.theme) return false;
    if (filters.category && book.category !== filters.category) return false;
    if (filters.status === "read" && !isRead(book)) return false;
    if (filters.status === "unread" && isRead(book)) return false;
    if (!query) return true;
    return [book.title, book.author, book.intro, book.note, book.category, themeMap[book.theme]?.name]
      .join(" ").toLowerCase().includes(query);
  });
}

function renderSidebar() {
  const visibleBooks = state.books.filter(book => !book.deleted);
  const total = visibleBooks.length;
  const read = visibleBooks.filter(book => isRead(book)).length;
  els.statTotal.textContent = total;
  els.statRead.textContent = read;
  els.statUnread.textContent = total - read;
  els.statRate.textContent = total ? Math.round(read / total * 100) + "%" : "0%";

  const themeCounts = Object.fromEntries(state.themes.map(theme => [theme.id, 0]));
  visibleBooks.forEach(book => themeCounts[book.theme] = (themeCounts[book.theme] || 0) + 1);

  let nav = `<button class="side-all ${filters.theme === "all" && !filters.category ? "active" : ""}" data-theme="all"><span>全部书籍</span><span>${total}</span></button>`;
  state.themes.forEach(theme => {
    const cats = state.categories.filter(category => category.theme === theme.id);
    if (!cats.length) return;
    nav += `<details class="side-theme" ${filters.theme === theme.id ? "open" : ""} style="--accent:${theme.accent}">
      <summary><span class="theme-dot"></span><b>${escapeHtml(theme.name)}</b><small>${themeCounts[theme.id] || 0}</small></summary>
      <div class="side-categories">`;
    cats.forEach(category => {
      const count = visibleBooks.filter(book => book.theme === category.theme && book.category === category.name).length;
      nav += `<button class="side-cat ${filters.category === category.name && filters.theme === category.theme ? "active" : ""}" data-theme="${theme.id}" data-category="${escapeHtml(category.name)}"><span>${count}</span>${escapeHtml(category.name)}</button>`;
    });
    nav += `</div></details>`;
  });
  els.sideNav.innerHTML = nav;
}

function renderContent() {
  const books = filteredBooks();
  const categoryMap = new Map(state.categories.map(category => [category.id, category]));
  const groups = new Map();
  books.forEach(book => {
    const key = `${book.theme}::${book.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(book);
  });

  const orderedKeys = state.categories
    .map(category => category.id)
    .filter(key => groups.has(key));

  els.content.innerHTML = orderedKeys.map(key => {
    const category = categoryMap.get(key);
    const theme = themeMap[category.theme];
    const items = groups.get(key);
    const readCount = items.filter(book => isRead(book)).length;
    return `<section class="category-section">
      <div class="category-head">
        <div><h3>${escapeHtml(category.name)}</h3><p>${escapeHtml(category.description || theme?.description || "")}</p></div>
        <div class="category-numbers">${items.length} 本 · 我已读 ${readCount}</div>
      </div>
      <div class="book-grid">${items.map(renderBook).join("")}</div>
    </section>`;
  }).join("");

  els.empty.style.display = books.length ? "none" : "block";
  const visibleBooks = state.books.filter(book => !book.deleted);
  const unread = visibleBooks.filter(book => !isRead(book)).length;
  els.resultText.innerHTML = `显示 <strong>${books.length}</strong> 本 · 全部 <strong>${visibleBooks.length}</strong> 本 · 我的未读 <strong>${unread}</strong> 本`;
  const labels = [];
  if (filters.theme !== "all") labels.push(themeMap[filters.theme]?.name || "");
  if (filters.category) labels.push(filters.category);
  if (filters.status === "read") labels.push("只看我已读");
  if (filters.status === "unread") labels.push("只看我未读");
  if (filters.query) labels.push(`搜索：${filters.query}`);
  els.activeFilter.textContent = labels.filter(Boolean).join(" · ");
}

function renderBook(book) {
  const theme = themeMap[book.theme];
  const mine = isRead(book);
  const added = book.addedBy
    ? `${book.addedBy === currentUser() ? "我" : book.addedBy} 新增`
    : "";
  const edited = book.updatedBy && book.updatedBy !== book.addedBy
    ? `${book.updatedBy === currentUser() ? "我" : book.updatedBy} 编辑`
    : "";
  return `<article class="book-card ${mine ? "read" : ""}" data-id="${book.id}">
    <div class="card-top">
      <div class="badges">
        <span class="badge">${escapeHtml(theme?.name || "")}</span>
        ${added ? `<span class="badge new">${escapeHtml(added)}</span>` : ""}
        ${edited ? `<span class="badge editor">${escapeHtml(edited)}</span>` : ""}
        ${mine ? '<span class="badge read">我已读</span>' : ""}
      </div>
      <div class="card-actions">
        <button class="icon-btn edit" title="编辑批注与简介">✎</button>
        <button class="icon-btn danger delete" title="删除">×</button>
      </div>
    </div>
    <h3 class="book-title">${escapeHtml(book.title)}</h3>
    <div class="author">${escapeHtml(book.author || "作者未注明")}</div>
    <p class="intro">${escapeHtml(book.intro || "还没有写简介，点击编辑补充。")}</p>
    ${book.note ? `<div class="book-note">${escapeHtml(book.note)}</div>` : ""}
    <div class="card-foot">
      <span class="read-state ${mine ? "done" : ""}">${mine ? "✓ 我已读" : "未读"}</span>
      <button class="read-toggle">${mine ? "标为未读" : "标记已读"}</button>
    </div>
  </article>`;
}

function renderAll() {
  refreshThemeMap();
  ensureCategories();
  renderSidebar();
  renderContent();
}

function openModal(book = null) {
  if (!teamMode) {
    openTeamModal();
    showToast("请先进入团队编辑模式");
    return;
  }
  editingId = book?.id || null;
  els.modalTitle.textContent = book ? "编辑书籍" : "添加书籍";
  els.title.value = book?.title || "";
  els.author.value = book?.author || "";
  els.theme.value = book?.theme || (filters.theme !== "all" && filters.theme) || state.themes[0]?.id || "";
  els.category.value = book?.category || (filters.category || "");
  els.intro.value = book?.intro || "";
  els.note.value = book?.note || "";
  els.read.checked = book ? isRead(book) : false;
  els.deleteBook.classList.toggle("hidden", !book);
  refreshCategoryOptions();
  els.modal.classList.add("open");
  setTimeout(() => els.title.focus(), 30);
}

function closeModal() {
  els.modal.classList.remove("open");
  editingId = null;
}

function refreshCategoryOptions() {
  const options = state.categories
    .filter(category => category.theme === els.theme.value)
    .map(category => `<option value="${escapeHtml(category.name)}"></option>`)
    .join("");
  els.categoryList.innerHTML = options;
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function saveBook(event) {
  event.preventDefault();
  if (!teamMode) {
    openTeamModal();
    return;
  }
  const title = els.title.value.trim();
  if (!title) return;
  const theme = els.theme.value;
  const category = els.category.value.trim();
  const now = new Date().toISOString();
  const intro = els.intro.value.trim() || `${els.author.value.trim() ? els.author.value.trim() + "作品，" : ""}收录于「${category}」，可作为该主题的延伸阅读。`;
  const payload = {
    title,
    author: els.author.value.trim(),
    theme,
    category,
    intro,
    note: els.note.value.trim(),
    updatedAt: now
  };
  if (editingId) {
    const book = state.books.find(item => item.id === editingId);
    if (book) {
      Object.assign(book, payload);
      book.updatedBy = currentUser();
      setRead(book, els.read.checked);
    }
    showToast("书籍已更新");
  } else {
    const book = {
      ...payload,
      id: crypto.randomUUID ? crypto.randomUUID() : "book-" + Date.now(),
      addedBy: currentUser(),
      addedAt: now.slice(0, 10),
      readBy: {},
      isNew: true,
      deleted: false
    };
    setRead(book, els.read.checked);
    state.books.push(book);
    showToast("已加入共享书单");
  }
  state.updatedAt = now;
  markDirty();
  saveState();
  closeModal();
  renderAll();
}

function deleteBook() {
  if (!editingId) return;
  const book = state.books.find(item => item.id === editingId);
  if (!book) return;
  if (!confirm(`确定删除《${book.title}》吗？其他人也将看不到。`)) return;
  const now = new Date().toISOString();
  book.deleted = true;
  book.updatedAt = now;
  book.updatedBy = currentUser();
  state.updatedAt = now;
  markDirty();
  saveState();
  closeModal();
  renderAll();
  showToast("已移出共享书单");
}

function toggleRead(id) {
  const book = state.books.find(item => item.id === id);
  if (!book) return;
  const next = !isRead(book);
  setRead(book, next);
  state.updatedAt = new Date().toISOString();
  markDirty();
  saveState();
  renderAll();
  showToast(next ? "已标记为已读" : "已标为未读");
}

function randomUnread() {
  const allUnread = state.books.filter(book => !book.deleted && !isRead(book));
  if (!allUnread.length) {
    showToast("全部读完了，厉害。");
    return;
  }
  const clean = allUnread.filter(book => book.title.length <= 34 && (book.title.match(/《/g) || []).length <= 1);
  const unread = clean.length ? clean : allUnread;
  const book = unread[Math.floor(Math.random() * unread.length)];
  const theme = themeMap[book.theme];
  els.spotlight.innerHTML = `<div>
    <small>TODAY'S PICK · ${escapeHtml(theme?.name || "")}</small>
    <h3>《${escapeHtml(book.title)}》</h3>
    <p>${escapeHtml(book.author || "作者未注明")} · ${escapeHtml(book.category)}</p>
  </div><button id="pickAgain">换一本</button>`;
  document.getElementById("pickAgain").addEventListener("click", randomUnread);
  els.spotlight.dataset.bookId = book.id;
}

function exportData() {
  const payload = { version: 3, exportedAt: new Date().toISOString(), data: state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `我的书单备份_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("备份已导出");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const imported = parsed.data || parsed;
      if (!imported.books || !imported.themes) throw new Error("格式不正确");
      if (!confirm("导入会合并到当前共享书单，同名书不会重复添加。继续吗？")) return;
      const knownIds = new Set(state.books.map(book => book.id));
      const knownTitles = new Set(state.books.map(book => normTitle(book.title)));
      imported.books.forEach(book => {
        if (knownIds.has(book.id) || knownTitles.has(normTitle(book.title))) return;
        state.books.push({ ...book, readBy: book.readBy || {}, deleted: Boolean(book.deleted) });
        knownIds.add(book.id);
        knownTitles.add(normTitle(book.title));
      });
      const knownCategories = new Set(state.categories.map(category => category.id));
      (imported.categories || []).forEach(category => {
        if (!knownCategories.has(category.id)) {
          state.categories.push(category);
          knownCategories.add(category.id);
        }
      });
      const knownThemes = new Set(state.themes.map(theme => theme.id));
      (imported.themes || []).forEach(theme => {
        if (!knownThemes.has(theme.id)) {
          state.themes.push(theme);
          knownThemes.add(theme.id);
        }
      });
      normalizeState();
      migrateReadStatus();
      state.updatedAt = new Date().toISOString();
      saveState();
      markDirty();
      renderAll();
      showToast("备份已导入");
    } catch (error) {
      alert("导入失败：文件格式不正确");
    }
  };
  reader.readAsText(file, "utf-8");
}

function formatTime(date) {
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function setSyncStatus(text) {
  if (els.syncStatus) els.syncStatus.textContent = text;
  if (els.teamStatus) {
    els.teamStatus.textContent = teamMode ? `编辑中：${team.name} · ${text}` : text;
  }
}

function markDirty() {
  dirty = true;
  localStorage.setItem(DIRTY_KEY, "1");
  setSyncStatus(teamMode ? "有未同步修改" : "只读模式");
  if (teamMode) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(), 1500);
  }
}

function updateTeamUI() {
  document.body.classList.toggle("team-mode", teamMode);
  const button = document.getElementById("teamBtn");
  if (button) button.textContent = teamMode ? `编辑中 · ${team.name}` : "团队编辑";
  if (els.teamName) els.teamName.value = team.name || "";
  if (els.teamToken) {
    els.teamToken.value = "";
    els.teamToken.placeholder = team.token ? "已保存令牌；留空沿用" : "github_pat_...";
  }
  setSyncStatus(teamMode ? "已连接" : "只读模式");
}

function openTeamModal() {
  updateTeamUI();
  els.teamModal.classList.add("open");
  setTimeout(() => els.teamName.focus(), 30);
}

function closeTeamModal() {
  els.teamModal.classList.remove("open");
}

async function connectTeam() {
  const name = els.teamName.value.trim();
  const tokenInput = els.teamToken.value.trim();
  const token = tokenInput || team.token;
  if (!name || !token) {
    showToast("请填写名字和编辑令牌");
    return;
  }
  setSyncStatus("验证令牌…");
  try {
    const response = await fetch(API_CONTENTS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (![200, 404].includes(response.status)) {
      throw new Error(response.status === 401 ? "令牌无效" : `GitHub ${response.status}`);
    }
    team = { name, token };
    saveTeam();
    teamMode = true;
    dirty = true;
    localStorage.setItem(DIRTY_KEY, "1");
    updateTeamUI();
    closeTeamModal();
    showToast("已进入团队编辑模式");
    await syncNow({ manual: true });
  } catch (error) {
    setSyncStatus(`连接失败：${error.message}`);
    showToast(`连接失败：${error.message}`);
  }
}

function exitTeam() {
  if (!confirm("退出后本机将不再自动同步，确定吗？")) return;
  localStorage.removeItem(TEAM_KEY);
  team = {};
  teamMode = false;
  updateTeamUI();
  closeTeamModal();
  showToast("已退出团队编辑");
}

function decodeBase64Utf8(base64) {
  const binary = atob(String(base64 || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

async function fetchRemoteApi() {
  const response = await fetch(API_CONTENTS_URL, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${team.token}`,
      Accept: "application/vnd.github+json"
    }
  });
  if (response.status === 404) return { data: null, sha: null };
  if (!response.ok) throw new Error(`读取失败 ${response.status}`);
  const payload = await response.json();
  return { data: JSON.parse(decodeBase64Utf8(payload.content)), sha: payload.sha };
}

function mergeStates(remote, local) {
  const books = new Map();
  (remote.books || []).forEach(book => books.set(book.id, { ...book }));
  (local.books || []).forEach(localBook => {
    const remoteBook = books.get(localBook.id);
    if (!remoteBook) {
      books.set(localBook.id, { ...localBook });
      return;
    }
    const remoteTime = Date.parse(remoteBook.updatedAt || 0) || 0;
    const localTime = Date.parse(localBook.updatedAt || 0) || 0;
    const newer = localTime > remoteTime ? localBook : remoteBook;
    const merged = { ...remoteBook, ...newer };
    merged.readBy = { ...(remoteBook.readBy || {}), ...(localBook.readBy || {}) };
    merged.addedBy = newer.addedBy || remoteBook.addedBy || localBook.addedBy || "";
    merged.updatedBy = newer.updatedBy || remoteBook.updatedBy || localBook.updatedBy || "";
    merged.deleted = Boolean(newer.deleted);
    books.set(localBook.id, merged);
  });
  const mergeById = (remoteItems, localItems) => {
    const items = new Map();
    (remoteItems || []).forEach(item => items.set(item.id, item));
    (localItems || []).forEach(item => {
      if (!items.has(item.id)) items.set(item.id, item);
    });
    return [...items.values()];
  };
  return {
    ...remote,
    ...local,
    updatedAt: new Date().toISOString(),
    books: [...books.values()],
    categories: mergeById(remote.categories, local.categories),
    themes: mergeById(remote.themes, local.themes)
  };
}

function stateForSync() {
  return {
    version: 3,
    updatedAt: state.updatedAt || new Date().toISOString(),
    themes: state.themes,
    categories: state.categories,
    books: state.books.map(book => {
      const copy = { ...book };
      delete copy.read;
      return copy;
    })
  };
}

async function loadRemoteData() {
  try {
    const response = await fetch(`${RAW_DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = await response.json();
    if (!remote || !Array.isArray(remote.books)) return;
    const remoteTime = Date.parse(remote.updatedAt || 0) || 0;
    const localTime = Date.parse(state.updatedAt || 0) || 0;
    if (remoteTime <= localTime && state.books.length >= remote.books.length) return;
    state = mergeStates(remote, state);
    normalizeState();
    migrateReadStatus();
    saveState();
    renderAll();
    setSyncStatus(`共享数据 ${formatTime(new Date())}`);
  } catch (error) {
    console.warn("远程数据加载失败", error);
  }
}

async function syncNow({ manual = false } = {}) {
  if (!teamMode || !team.token) {
    if (manual) openTeamModal();
    return;
  }
  if (syncInFlight) return;
  syncInFlight = true;
  setSyncStatus("同步中…");
  try {
    const remoteInfo = await fetchRemoteApi();
    if (remoteInfo.data) {
      state = mergeStates(remoteInfo.data, state);
      normalizeState();
      migrateReadStatus();
      saveState();
      renderAll();
    }
    if (!dirty) {
      setSyncStatus(`已同步 ${formatTime(new Date())}`);
      return;
    }
    state.updatedAt = new Date().toISOString();
    const body = JSON.stringify(stateForSync());
    const response = await fetch(API_CONTENTS_URL, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${team.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `书单更新 · ${currentUser()} · ${new Date().toLocaleString("zh-CN")}`,
        content: encodeBase64Utf8(body),
        branch: BRANCH,
        ...(remoteInfo.sha ? { sha: remoteInfo.sha } : {})
      })
    });
    if (response.status === 409) {
      syncInFlight = false;
      return syncNow({ manual });
    }
    if (!response.ok) throw new Error(`保存失败 ${response.status}`);
    dirty = false;
    localStorage.removeItem(DIRTY_KEY);
    setSyncStatus(`已保存 ${formatTime(new Date())}`);
    saveState();
    renderAll();
    if (manual) showToast("已同步到共享书单");
  } catch (error) {
    console.warn(error);
    setSyncStatus(`同步失败：${error.message}`);
    if (manual) showToast(`同步失败：${error.message}`);
  } finally {
    syncInFlight = false;
  }
}

async function pollRemote() {
  if (document.hidden) return;
  if (teamMode) {
    if (dirty || syncInFlight) return;
    try {
      const remoteInfo = await fetchRemoteApi();
      if (!remoteInfo.data) return;
      state = mergeStates(remoteInfo.data, state);
      normalizeState();
      migrateReadStatus();
      saveState();
      renderAll();
      setSyncStatus(`已同步 ${formatTime(new Date())}`);
    } catch (error) {
      console.warn("轮询失败", error);
    }
  } else {
    loadRemoteData();
  }
}

els.search.addEventListener("input", () => {
  filters.query = els.search.value;
  els.clearSearch.style.display = filters.query ? "block" : "none";
  renderContent();
});

els.clearSearch.addEventListener("click", () => {
  els.search.value = "";
  filters.query = "";
  els.clearSearch.style.display = "none";
  renderContent();
  els.search.focus();
});

document.querySelectorAll(".status-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    filters.status = tab.dataset.status;
    document.querySelectorAll(".status-tab").forEach(item => item.classList.toggle("active", item === tab));
    renderContent();
  });
});

els.sideNav.addEventListener("click", event => {
  const cat = event.target.closest(".side-cat");
  const all = event.target.closest(".side-all");
  if (all) {
    filters.theme = "all";
    filters.category = null;
    renderAll();
    return;
  }
  if (cat) {
    filters.theme = cat.dataset.theme;
    filters.category = cat.dataset.category;
    renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

els.content.addEventListener("click", event => {
  const card = event.target.closest(".book-card");
  if (!card) return;
  const id = card.dataset.id;
  if (event.target.closest(".read-toggle")) return toggleRead(id);
  if (event.target.closest(".edit")) return openModal(state.books.find(book => book.id === id));
  if (event.target.closest(".delete")) {
    editingId = id;
    return deleteBook();
  }
});

els.spotlight.addEventListener("click", event => {
  const id = els.spotlight.dataset.bookId;
  if (event.target.id === "pickBtn" || event.target.id === "pickAgain") return randomUnread();
  if (event.target.closest("h3") && id) {
    if (!teamMode) {
      showToast("进入团队编辑后可修改这本书");
      return;
    }
    const book = state.books.find(item => item.id === id);
    if (book) openModal(book);
  }
});

document.getElementById("topAdd").addEventListener("click", () => openModal());
document.getElementById("sideAdd").addEventListener("click", () => openModal());
document.getElementById("randomTop").addEventListener("click", randomUnread);
document.getElementById("randomSide").addEventListener("click", randomUnread);
els.modal.addEventListener("click", event => { if (event.target === els.modal) closeModal(); });
document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("cancelModal").addEventListener("click", closeModal);
els.form.addEventListener("submit", saveBook);
els.theme.addEventListener("change", refreshCategoryOptions);
els.deleteBook.addEventListener("click", deleteBook);
document.getElementById("exportBtn").addEventListener("click", exportData);
document.getElementById("importBtn").addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (file) importData(file);
  event.target.value = "";
});

document.getElementById("teamBtn").addEventListener("click", openTeamModal);
document.getElementById("teamClose").addEventListener("click", closeTeamModal);
document.getElementById("teamConnect").addEventListener("click", connectTeam);
document.getElementById("teamSync").addEventListener("click", () => syncNow({ manual: true }));
document.getElementById("teamExit").addEventListener("click", exitTeam);
els.teamModal.addEventListener("click", event => { if (event.target === els.teamModal) closeTeamModal(); });

updateTeamUI();
refreshThemeMap();
ensureCategories();
els.theme.innerHTML = state.themes.map(theme => `<option value="${theme.id}">${escapeHtml(theme.name)}</option>`).join("");
renderAll();
randomUnread();
setInterval(pollRemote, 45000);

if (teamMode) {
  syncNow();
} else {
  loadRemoteData();
}
