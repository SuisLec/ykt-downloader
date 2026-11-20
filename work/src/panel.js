(() => {
  "use strict";

  if (window.top !== window.self || document.getElementById("ykt-downloader-host")) return;

  const { YktApi, YktDownload } = globalThis;
  const destinationKey = "ykt-downloader:destination";
  const supportsSavePicker = typeof window.showSaveFilePicker === "function";
  const api = YktApi.create({ request: YktDownload.request });
  const host = document.createElement("div");
  host.id = "ykt-downloader-host";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <button class="launcher" id="launcher" type="button" aria-expanded="false" aria-controls="panel">
      <span aria-hidden="true">↓</span> 下载课件
    </button>
    <section class="panel" id="panel" aria-labelledby="heading" hidden>
      <header class="header">
        <h2 id="heading">雨课堂课件</h2>
        <button class="close" type="button" id="close" aria-label="关闭面板">×</button>
      </header>
      <div class="course-row">
        <label class="course-field" for="course">课程
          <select id="course"><option value="">待读取课程</option></select>
        </label>
        <button class="plain refresh" id="refresh" type="button">刷新</button>
      </div>
      <div class="library">
        <div class="toolbar">
          <input id="search" type="search" placeholder="搜索章节或课件" aria-label="搜索章节或课件">
          <button class="plain" id="selectAll" type="button">全选</button>
          <button class="plain" id="clear" type="button">清空</button>
        </div>
        <div class="items" id="items" aria-label="课件列表"></div>
      </div>
      <div class="options">
        <label for="layout">每页张数<select id="layout"><option value="1">1 张</option><option value="2">2 张</option><option value="4">4 张</option></select></label>
        <label for="orientation">纸张方向<select id="orientation"><option value="landscape">横向</option><option value="portrait">竖向</option></select></label>
        <label class="destination-field" for="destination">下载地址
          <select id="destination" aria-describedby="destinationHint">
            <option value="browser">浏览器默认位置</option>
            <option value="choose">每次选择位置</option>
          </select>
        </label>
        <p class="destination-hint" id="destinationHint"></p>
      </div>
      <footer class="footer">
        <progress id="progress" max="1" value="0" aria-label="导出进度" hidden></progress>
        <p id="status" class="status" role="status" aria-live="polite"></p>
        <details id="details" hidden><summary>查看失败条目</summary><ul id="issues"></ul></details>
        <div class="save-actions" id="saveActions" hidden>
          <button class="primary" id="pickLocation" type="button" hidden>选择保存位置</button>
          <a id="save" class="save">再次保存文件</a>
        </div>
        <div class="actions">
          <button class="plain" id="cancel" type="button" hidden>取消</button>
          <button class="plain" id="downloadSelected" type="button">下载所选</button>
          <button class="primary" id="downloadAll" type="button">下载全部</button>
        </div>
      </footer>
    </section>`;

  const css = `
    :host { all: initial; color-scheme: light; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: #182739; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button, select, input { font: inherit; color: inherit; }
    button { cursor: pointer; }
    button:disabled, select:disabled, input:disabled { opacity: .53; cursor: default; }
    :focus-visible { outline: 3px solid #71a9fa; outline-offset: 2px; }
    button, select, input[type=search] { border: 1px solid #cfdae6; border-radius: 8px; background: #fff; }
    .launcher, .panel { position: fixed; z-index: 2147483646; right: 20px; bottom: 20px; }
    .launcher { display: flex; align-items: center; gap: 8px; border: 0; padding: 11px 16px; color: #fff; background: #164ca3; border-radius: 999px; font-weight: 700; box-shadow: 0 5px 18px #15356540; }
    .launcher span { display: grid; place-items: center; width: 22px; height: 22px; background: #ffffff26; border-radius: 50%; font-size: 17px; line-height: 1; }
    .launcher:hover, .primary:hover:not(:disabled) { background: #123c80; }
    .panel { display: flex; flex-direction: column; width: min(442px, calc(100vw - 40px)); max-height: min(732px, calc(100vh - 40px)); max-height: min(732px, calc(100dvh - 40px)); overflow: auto; background: #fff; border: 1px solid #d1ddeb; border-radius: 16px; box-shadow: 0 12px 46px #142c553c; }
    .header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 17px 18px 15px; background: #edf4ff; border-bottom: 1px solid #dee8f5; }
    h2 { margin: 0; font-size: 19px; font-weight: 750; letter-spacing: .015em; color: #17365f; }
    .close { display: grid; place-items: center; width: 34px; height: 34px; color: #365075; font-size: 23px; line-height: 1; }
    .plain:hover:not(:disabled), .close:hover { background: #eef5ff; }
    .course-row, .toolbar, .actions { display: flex; align-items: center; gap: 7px; }
    .course-row { padding: 13px 16px 10px; align-items: end; }
    .course-field { flex: 1; min-width: 0; }
    label[for] { font-size: 12px; font-weight: 650; color: #40546e; }
    select { display: block; width: 100%; margin-top: 4px; padding: 0 8px; height: 36px; font-size: 13px; font-weight: 500; }
    .plain, .primary { padding: 0 11px; height: 36px; white-space: nowrap; font-size: 13px; font-weight: 650; }
    .primary { background: #164ca3; color: #fff; border-color: transparent; }
    .library { display: flex; flex-direction: column; flex: 1; min-height: 125px; margin: 0 16px; }
    .toolbar { margin-bottom: 8px; }
    input[type=search] { min-width: 0; flex: 1; height: 36px; padding: 0 9px; font-size: 13px; }
    .items { min-height: 75px; max-height: 315px; overflow: auto; overscroll-behavior: contain; border: 1px solid #deE6f0; border-radius: 10px; }
    .group { position: sticky; top: 0; z-index: 1; background: #f2f6fb; color: #324a69; font-weight: 700; }
    .group, .item { display: flex; align-items: center; gap: 9px; padding: 7px 11px; min-height: 35px; font-size: 13px; cursor: pointer; }
    .item + .item { border-top: 1px solid #eef2f7; }
    .item:hover { background: #f7faff; }
    .item input, .group input { accent-color: #164ca3; width: 16px; height: 16px; margin: 0; flex: 0 0 auto; }
    .group span, .item span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .item small { color: #516985; white-space: nowrap; font-size: 11px; }
    .empty { margin: 0; padding: 14px; font-size: 13px; color: #4a6080; }
    .options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px 16px; }
    .destination-field, .destination-hint { grid-column: 1 / -1; }
    .destination-hint { margin: -3px 0 0; color: #516985; font-size: 12px; }
    .footer { background: #f6f8fc; border-top: 1px solid #e2e9f3; padding: 10px 16px 13px; }
    .status { margin: 0 0 8px; min-height: 18px; color: #425a78; font-size: 12px; overflow-wrap: anywhere; }
    .status[data-tone=error] { color: #9a3423; }
    .actions { justify-content: flex-end; flex-wrap: wrap; }
    progress { display: block; height: 8px; width: 100%; margin-bottom: 7px; accent-color: #164ca3; }
    details { color: #813426; font-size: 12px; margin: 0 0 7px; }
    summary { cursor: pointer; }
    details ul { max-height: 107px; margin: 4px 0; overflow: auto; padding-left: 20px; overflow-wrap: anywhere; }
    .save-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; margin-bottom: 8px; }
    .save { display: inline-block; color: #164ca3; font-size: 12px; }
    @media (max-width: 470px) {
      .panel, .launcher { right: 8px; bottom: 8px; }
      .panel { width: calc(100vw - 16px); max-height: calc(100vh - 16px); max-height: calc(100dvh - 16px); }
    }
  `;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = css;
    shadow.prepend(style);
  }
  (document.body || document.documentElement).append(host);

  const elements = Object.fromEntries([...shadow.querySelectorAll("[id]")].map((node) => [node.id, node]));
  let courseList = [];
  let items = [];
  let selected = new Set();
  let selectedCourse = "";
  let coursesController;
  let itemsController;
  let jobController;
  let routeKey = "";
  let started = false;
  let objectUrl = "";
  let generatedFile;
  let savingFile = false;
  let groupsShown = [];
  let rowsShown = [];
  let catalogMessage = "";
  let activeIssueMessage = "";

  function textStatus(message = "", tone = "") {
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  }

  function itemStatus() {
    const count = selected.size;
    if (activeIssueMessage) textStatus(activeIssueMessage, "error");
    else if (itemsController) textStatus("正在读取课件…");
    else if (items.length) textStatus(`已选 ${count} / ${items.length} 项${catalogMessage ? ` · ${catalogMessage}` : ""}`);
    else textStatus(catalogMessage);
  }

  function syncControls() {
    const busy = Boolean(jobController) || savingFile;
    const loading = Boolean(itemsController);
    elements.course.disabled = busy || !courseList.length;
    elements.refresh.disabled = busy || Boolean(coursesController);
    elements.search.disabled = busy || !items.length;
    elements.selectAll.disabled = busy || !items.length || selected.size === items.length;
    elements.clear.disabled = busy || !selected.size;
    elements.downloadSelected.disabled = busy || loading || !selected.size;
    elements.downloadAll.disabled = busy || loading || !items.length;
    elements.cancel.hidden = !jobController;
    elements.pickLocation.disabled = busy;
    elements.save.hidden = savingFile;
    for (const field of [elements.layout, elements.orientation, elements.destination]) field.disabled = busy;
    for (const { box, item } of rowsShown) {
      box.checked = selected.has(item.key);
      box.disabled = busy;
    }
    for (const { box, group } of groupsShown) {
      const count = group.filter((item) => selected.has(item.key)).length;
      box.checked = count === group.length;
      box.indeterminate = count > 0 && count < group.length;
      box.disabled = busy;
    }
  }

  function messageInList(message) {
    const hint = document.createElement("p");
    hint.className = "empty";
    hint.textContent = message;
    elements.items.replaceChildren(hint);
  }

  function checkRow(className, name, isChecked, onChange) {
    const row = document.createElement("label");
    row.className = className;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = isChecked;
    box.addEventListener("change", () => {
      onChange(box.checked);
      syncControls();
      itemStatus();
    });
    const title = document.createElement("span");
    title.textContent = name;
    row.append(box, title);
    return { row, box };
  }

  function selectItem(item, checked) {
    if (checked) selected.add(item.key);
    else selected.delete(item.key);
  }

  function renderItems() {
    rowsShown = [];
    groupsShown = [];
    const query = elements.search.value.trim().toLocaleLowerCase();
    const groups = new Map();
    for (const item of items) {
      const group = item.group || "课件与课堂";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    const fragment = document.createDocumentFragment();
    for (const [name, group] of groups) {
      const visible = group.filter((item) => `${name} ${item.title}`.toLocaleLowerCase().includes(query));
      if (!visible.length) continue;
      const section = document.createElement("div");
      const heading = checkRow("group", name, false, (checked) => {
        for (const item of group) selectItem(item, checked);
      });
      groupsShown.push({ box: heading.box, group });
      section.append(heading.row);
      for (const item of visible) {
        const entry = checkRow("item", item.title, selected.has(item.key), (checked) => selectItem(item, checked));
        rowsShown.push({ box: entry.box, item });
        if (item.pages) {
          const detail = document.createElement("small");
          detail.textContent = `${item.pages} 张`;
          entry.row.append(detail);
        }
        section.append(entry.row);
      }
      fragment.append(section);
    }
    if (fragment.childElementCount) elements.items.replaceChildren(fragment);
    else if (itemsController) messageInList("正在读取课件…");
    else if (items.length) messageInList("没有匹配的章节或课件");
    else messageInList(activeIssueMessage || (selectedCourse ? "此课程暂无可列出的课件" : "登录雨课堂后选择课程"));
    syncControls();
  }

  function clearResult() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
    generatedFile = undefined;
    elements.saveActions.hidden = true;
    elements.save.removeAttribute("href");
    elements.details.hidden = true;
    elements.details.open = false;
    elements.issues.replaceChildren();
  }

  function updateDestination() {
    const choose = elements.destination.value === "choose";
    if (!choose) elements.destinationHint.textContent = "按浏览器的下载设置保存，通常在「下载」文件夹。";
    else if (supportsSavePicker) elements.destinationHint.textContent = "导出后点击「选择保存位置」，选择文件夹。";
    else elements.destinationHint.textContent = "导出后右键点「保存文件」，选择「下载链接文件为…」或「将链接另存为…」。";
    elements.pickLocation.hidden = !choose || !supportsSavePicker;
    elements.save.textContent = choose ? "保存文件" : "再次保存文件";
    elements.save.title = choose ? "右键另存。单击按浏览器设置保存。" : "";
  }

  async function saveToLocation() {
    const file = generatedFile;
    if (!file || savingFile || !supportsSavePicker || elements.destination.value !== "choose") return;
    savingFile = true;
    syncControls();
    let writer;
    try {
      const isZip = file.blob.type === "application/zip";
      const handle = await window.showSaveFilePicker({
        id: "ykt-courseware",
        suggestedName: file.filename,
        types: [{
          description: isZip ? "ZIP 压缩包" : "PDF 文件",
          accept: { [file.blob.type]: [isZip ? ".zip" : ".pdf"] },
        }],
      });
      writer = await handle.createWritable();
      await writer.write(file.blob);
      await writer.close();
      textStatus(`已保存 · ${handle.name}`);
    } catch (error) {
      if (writer) await writer.abort().catch(() => {});
      if (error?.name === "AbortError") textStatus(`保存已取消 · ${file.filename} 仍可保存`);
      else textStatus("无法保存到所选位置。可以重试，或右键点击「保存文件」另存。", "error");
    } finally {
      savingFile = false;
      syncControls();
    }
  }

  function renderCourses() {
    const options = courseList.map((course) => new Option(
      course.subtitle ? `${course.title} · ${course.subtitle}` : course.title, course.id,
    ));
    if (!options.length) options.push(new Option(coursesController ? "正在读取课程…" : "暂无可选课程", ""));
    elements.course.replaceChildren(...options);
    elements.course.value = selectedCourse;
    syncControls();
  }

  async function loadItems(course) {
    itemsController?.abort();
    itemsController = course ? new AbortController() : undefined;
    const controller = itemsController;
    selectedCourse = course?.id || "";
    selected = new Set();
    items = [];
    elements.search.value = "";
    activeIssueMessage = "";
    clearResult();
    renderCourses();
    renderItems();
    itemStatus();
    if (!controller) return;
    try {
      items = await api.items(course, controller.signal).then((list) => controller.signal.aborted ? items : list);
    } catch (error) {
      if (!controller.signal.aborted) activeIssueMessage = error.message || "读取课件失败";
    } finally {
      if (itemsController === controller) {
        itemsController = undefined;
        renderItems();
        itemStatus();
      }
    }
  }

  async function refresh(current, preferCurrent) {
    coursesController?.abort();
    const controller = new AbortController();
    coursesController = controller;
    catalogMessage = "";
    const courseId = preferCurrent ? current?.id : selectedCourse || current?.id;
    const prior = courseList.find((course) => course.id === courseId);
    if (current?.id && !courseList.some((course) => course.id === current.id)) courseList.unshift(current);
    if (prior || (courseId && current?.id === courseId)) loadItems(prior || current);
    else if (!itemsController) {
      messageInList("正在读取课程…");
      textStatus("正在读取课程…");
    }
    renderCourses();
    try {
      const list = await api.courses(current, controller.signal);
      if (controller.signal.aborted) return;
      courseList = list;
      if (current?.id && !courseList.some((course) => course.id === current.id)) courseList.unshift(current);
      const next = courseList.find((course) => course.id === selectedCourse)
        || courseList.find((course) => course.id === courseId) || courseList[0];
      if (!prior && !selectedCourse && next) loadItems(next);
      if (!courseList.length) {
        catalogMessage = "未找到已加入的课程，请检查雨课堂登录状态";
        renderItems();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      catalogMessage = courseList.length ? "课程目录读取失败" : error.message || "读取课程失败";
      if (!courseList.length) messageInList(catalogMessage);
    } finally {
      if (coursesController === controller) {
        coursesController = undefined;
        renderCourses();
        itemStatus();
      }
    }
  }

  function openPanel() {
    elements.launcher.hidden = true;
    elements.launcher.setAttribute("aria-expanded", "true");
    elements.panel.hidden = false;
    elements.close.focus();
    const current = YktApi.route();
    const key = current?.id || "";
    if (!jobController && !savingFile && (!started || key !== routeKey)) {
      started = true;
      routeKey = key;
      refresh(current, true);
    }
  }

  function closePanel() {
    elements.panel.hidden = true;
    elements.launcher.hidden = false;
    elements.launcher.setAttribute("aria-expanded", "false");
    elements.launcher.focus();
  }

  async function download(all) {
    const course = courseList.find((entry) => entry.id === selectedCourse);
    const targets = all ? [...items] : items.filter((item) => selected.has(item.key));
    if (!course || !targets.length || jobController || savingFile || itemsController) return;
    clearResult();
    jobController = new AbortController();
    const { signal } = jobController;
    elements.cancel.disabled = false;
    elements.progress.value = 0;
    elements.progress.hidden = false;
    syncControls();
    try {
      const settings = {
        layout: Number(elements.layout.value),
        orientation: elements.orientation.value,
      };
      const result = await YktDownload.run(api, course, targets, settings, signal, (message, fraction) => {
        if (signal.aborted) return;
        elements.progress.value = fraction;
        textStatus(message);
      });
      if (!result.blob) textStatus(`未生成文件 · ${targets.length} 项导出失败`, "error");
      else {
        generatedFile = result;
        objectUrl = URL.createObjectURL(result.blob);
        elements.save.href = objectUrl;
        elements.save.download = result.filename;
        elements.saveActions.hidden = false;
        if (elements.destination.value === "browser") elements.save.click();
        textStatus(result.issues.length
          ? `已生成部分文件 · ${result.filename} · 完整 ${result.complete}/${targets.length} 项`
          : `文件已生成 · ${result.filename} · ${result.complete} 项，共 ${result.slidesWritten} 张`,
        result.issues.length ? "error" : "");
      }
      if (result.issues.length) {
        elements.details.hidden = false;
        for (const { title, reason } of result.issues) {
          const entry = document.createElement("li");
          entry.textContent = `${title} · ${reason}`;
          elements.issues.append(entry);
        }
      }
    } catch (error) {
      textStatus(signal.aborted ? "下载已取消" : error.message || "导出失败", signal.aborted ? "" : "error");
    } finally {
      jobController = undefined;
      elements.progress.hidden = true;
      syncControls();
    }
  }

  elements.launcher.addEventListener("click", openPanel);
  elements.close.addEventListener("click", closePanel);
  shadow.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || elements.panel.hidden) return;
    event.stopPropagation();
    closePanel();
  });
  elements.course.addEventListener("change", () => loadItems(courseList.find((course) => course.id === elements.course.value)));
  elements.refresh.addEventListener("click", () => refresh(YktApi.route(), false));
  elements.search.addEventListener("input", renderItems);
  elements.selectAll.addEventListener("click", () => {
    selected = new Set(items.map((item) => item.key));
    syncControls();
    itemStatus();
  });
  elements.clear.addEventListener("click", () => {
    selected.clear();
    syncControls();
    itemStatus();
  });
  try {
    if (localStorage.getItem(destinationKey) === "choose") elements.destination.value = "choose";
  } catch {}
  updateDestination();
  elements.destination.addEventListener("change", () => {
    try {
      localStorage.setItem(destinationKey, elements.destination.value);
    } catch {}
    updateDestination();
  });
  elements.pickLocation.addEventListener("click", saveToLocation);
  elements.downloadSelected.addEventListener("click", () => download(false));
  elements.downloadAll.addEventListener("click", () => download(true));
  elements.cancel.addEventListener("click", () => {
    jobController?.abort();
    elements.cancel.disabled = true;
    textStatus("正在取消…");
  });
})();
