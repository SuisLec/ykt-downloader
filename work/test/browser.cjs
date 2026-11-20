const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium, webkit } = require("playwright-core");
const { PDFDocument } = require("pdf-lib");
const JSZip = require("jszip");
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

const outputs = path.resolve(__dirname, "../../outputs");
const extension = path.join(outputs, "ykt-downloader");
const scriptPath = path.join(outputs, "ykt-downloader.user.js");
const site = "https://www.yuketang.cn";
const cdn = "https://qn-scd1.yuketang.cn";
const fixtureUniversityId = 90001;
const startPage = `${site}/v2/web/studentLog/101?university_id=${fixtureUniversityId}&platform_id=3&classroom_id=101&tab=content`;
const sessionCookie = "fixture_session";
const lessonId = "7956348219014324577";
const presentationId = "7956348219014324581";
const slideId = "7956348219014324601";
const hiddenSlideId = "7956348219014324602";
const courseRows = [
  { classroom_id: 101, name: "绘图实验班", course: { name: "工程绘图" }, university_id: fixtureUniversityId, platform_id: 3 },
  { classroom_id: 102, name: "力学实验班", course: { name: "材料力学" }, university_id: fixtureUniversityId, platform_id: 3 },
];
const rowsByCourse = {
  101: [
    { id: 1001, type: 2, title: "正投影", courseware_id: 201, count: 5, chapter_id: 50, chapter_name: "投影法" },
    { id: 1002, type: 14, title: "视图与剖面", courseware_id: lessonId, count: 3, chapter_id: 51, chapter_name: "表达方法" },
    { id: 1003, type: 19, title: "不应看到的作业", courseware_id: 203 },
  ],
  102: [
    { id: 1004, type: 2, title: "应力分析", courseware_id: 204, count: 5, chapter_id: 52, chapter_name: "强度理论" },
  ],
};
const colors = [[207, 48, 72], [40, 126, 157], [39, 133, 70], [101, 59, 149], [182, 90, 31]];

function makeImage(index) {
  const width = 320;
  const height = 180;
  const pixels = Buffer.alloc(width * height * 4, 255);
  const color = colors[index];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      const whiteBar = row > 25 && row < 35 && column > 24 && column < 110 + index * 20;
      if (!whiteBar) {
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
      }
    }
  }
  return jpeg.encode({ data: pixels, width, height }, 90).data;
}

const slideUrl = (deck, page) => `${cdn}/fixture/assets/${deck}/${page}.jpg`;
const label = (panel, name) => panel.getByRole("combobox", { name });
const control = (panel, name) => panel.getByRole("button", { name, exact: true });
const jsonV2 = (data) => ({ errcode: 0, data });
const jsonV3 = (data) => ({ code: 0, data });
const numericFixtureIds = new Set([lessonId, presentationId, slideId, hiddenSlideId]);

function encodeFixture(data) {
  return JSON.stringify(data).replace(/"(\d{19})"/g, (token, id) => numericFixtureIds.has(id) ? id : token);
}

function courseActivities(course, page) {
  const rows = rowsByCourse[course] || [];
  const hasMore = course === "101" && page === 0;
  const currentPage = course === "101" ? (page === 0 ? rows.slice(0, 1) : rows.slice(1)) : rows;
  return { activities: currentPage, has_more: hasMore, total: rows.length };
}

function detailForDeck(deck) {
  const slides = colors.map((_, index) => ({
    PageIndex: index + 1,
    Cover: slideUrl(deck, index),
  }));
  return {
    Slides: slides,
    Downloadable: true,
    CanDownload: true,
  };
}

async function attachFixture(context) {
  const requests = [];
  const unexpected = [];
  let denyLesson = false;
  const images = colors.map((_, index) => makeImage(index));
  await context.addCookies([
    { name: sessionCookie, value: "fake", url: site },
    { name: "cdn_cookie", value: "must-not-send", url: cdn },
  ]);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;
    const headers = await request.allHeaders();
    const data = { url, headers, method: request.method() };
    requests.push(data);
    if (url.origin === cdn && pathname.startsWith("/fixture/assets/")) {
      const response = { headers: { "Access-Control-Allow-Origin": "*" } };
      const index = Number(path.basename(pathname, ".jpg"));
      await new Promise((resolve) => setTimeout(resolve, (4 - index) * 18));
      await route.fulfill({ ...response, contentType: "image/jpeg", body: images[index] });
      return;
    }
    if (url.origin !== site) {
      unexpected.push(`${request.method()} ${url}`);
      await route.abort();
      return;
    }
    if (pathname.startsWith("/v2/web/")) {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>雨课堂</title><main>模拟雨课堂课程</main></html>',
      });
      return;
    }
    if (pathname === "/favicon.ico") {
      await route.fulfill({ status: 204 });
      return;
    }
    let response;
    const activitiesMatch = pathname.match(/^\/v2\/api\/web\/logs\/learn\/(\d+)\/?$/);
    const deckMatch = pathname.match(/^\/v2\/api\/web\/cards\/detlist\/(\d+)\/?$/);
    const classroomMatch = pathname.match(/^\/v2\/api\/web\/classrooms\/(\d+)\/?$/);
    const permissionMatch = pathname.match(/^\/cards\/view_permission\/(\d+)\/?$/);
    if (pathname === "/v2/api/web/courses/list") {
      response = jsonV2({ list: courseRows });
    } else if (activitiesMatch) {
      response = jsonV2(courseActivities(activitiesMatch[1], Number(searchParams.get("page")) || 0));
    } else if (classroomMatch) {
      const course = courseRows.find((row) => Number(classroomMatch[1]) === row.classroom_id);
      response = jsonV2({ ...course, course_name: course.course.name, uv_id: course.university_id });
    } else if (pathname === "/mooc-api/v1/lms/learn/course/chapter") {
      const course = searchParams.get("classroom_id");
      const items = (rowsByCourse[course] || []).filter(({ type }) => type === 2 || type === 14);
      const chapters = items.map(({ chapter_id, chapter_name, id, title, type, courseware_id }) => ({
        id: chapter_id,
        name: chapter_name,
        section_leaf_list: [{ id, name: title, leaf_type: type === 2 ? 7 : 8, courseware_id }],
      }));
      response = { success: true, data: { course_chapter: chapters } };
    } else if (permissionMatch) {
      response = jsonV2(true);
    } else if (deckMatch) {
      response = jsonV2(detailForDeck(deckMatch[1]));
    } else if (pathname === "/api/v3/lesson-summary/student" || pathname === "/api/v3/classroom-report/student/lesson-info") {
      if (searchParams.get("lesson_id") !== lessonId) {
        unexpected.push(`Lesson ID changed to ${searchParams.get("lesson_id")}`);
        await route.fulfill({ status: 400, json: { code: 400, message: "课件编号错误" } });
        return;
      }
      response = jsonV3({
        presentationIds: [presentationId],
        presentations: [{ id: presentationId, presentationId, downloadable: true }],
        presentationList: [{ id: presentationId, presentationId, downloadable: true }],
        downloadable: true,
      });
    } else if (pathname === "/api/v3/lesson-summary/student/presentation" || pathname === "/api/v3/classroom-report/student/ppt") {
      if (searchParams.get("lesson_id") !== lessonId || ![searchParams.get("presentationId"), searchParams.get("presentation_id")].includes(presentationId)) {
        unexpected.push(`Presentation or lesson ID changed in ${url}`);
        await route.fulfill({ status: 400, json: { code: 400, message: "课件编号错误" } });
        return;
      }
      if (denyLesson) {
        await route.fulfill({ status: 403, json: { code: 403, message: "教师禁止下载该课件" } });
        return;
      }
      const slides = [2, 1, 0].map((index) => ({ index, cover: slideUrl(202, index) }));
      slides.push({ id: hiddenSlideId, index: 3, cover: slideUrl(202, 3) });
      slides[0].id = slideId;
      response = jsonV3({
        slides,
        slideList: slides,
        presentation: { conf: { show_presentation: "part", hide_slides: [hiddenSlideId] } },
        Downloadable: true,
        downloadable: true,
      });
    } else {
      unexpected.push(`${request.method()} ${url}`);
      await route.fulfill({ status: 404, json: { code: 404 } });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: encodeFixture(response) });
  });
  return {
    requests,
    unexpected,
    deny() { denyLesson = true; },
  };
}

function expectRenderedColor(image, x, y, colorIndex) {
  const offset = (Math.floor(y * image.height) * image.width + Math.floor(x * image.width)) * 4;
  const actual = [...image.data.subarray(offset, offset + 3)];
  const expected = colors[colorIndex];
  assert.ok(actual.every((component, channel) => Math.abs(component - expected[channel]) < 12),
    `color at (${x}, ${y}) was ${actual}, expected ${expected}`);
}

async function startPanel(page, mode) {
  await page.goto(startPage);
  if (mode !== "extension") await page.addScriptTag({ path: scriptPath });
  const panel = page.locator("#ykt-downloader-host");
  await control(panel, "下载课件").click();
  await panel.getByText("正投影", { exact: true }).waitFor();
  return panel;
}

async function optionByText(locator, text) {
  const available = await locator.locator("option").allTextContents();
  const match = available.find((option) => option.includes(text));
  assert.ok(match, `Missing option ${text}, found ${available.join(", ")}`);
  await locator.selectOption({ label: match });
}

async function format(panel, slides, orientation) {
  await label(panel, "每页张数").selectOption(String(slides));
  await optionByText(label(panel, "纸张方向"), orientation);
}

async function getFile(page, trigger, filename) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    trigger.click(),
  ]);
  assert.ok(download.suggestedFilename().endsWith(path.extname(filename)), download.suggestedFilename());
  await download.saveAs(filename);
  assert.equal(await download.failure(), null);
  return download.suggestedFilename();
}

async function getPdf(page, panel, buttonName, filename, expectedName) {
  assert.equal(await getFile(page, control(panel, buttonName), filename), expectedName);
  return PDFDocument.load(await fs.readFile(filename));
}

async function verifySessionTransport(context) {
  const server = http.createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("Set-Cookie", `${sessionCookie}=local; Path=/; HttpOnly; SameSite=Lax`);
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Session fixture</title>");
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ authenticated: request.headers.cookie?.includes(`${sessionCookie}=local`) ?? false }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ path: scriptPath });
    const result = await page.evaluate(() => globalThis.YktDownload.request("/session"));
    assert.equal(result.authenticated, true);
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function verifyPlacedImages(mode, temp, page, panel, fixture) {
  await panel.getByText("视图与剖面", { exact: true }).waitFor();
  assert.equal(await panel.getByText("不应看到的作业", { exact: true }).count(), 0);
  await control(panel, "全选").click();
  assert.ok(await panel.getByRole("checkbox", { name: /正投影/ }).isChecked());
  assert.ok(await panel.getByRole("checkbox", { name: /视图与剖面/ }).isChecked());
  await control(panel, "清空").click();
  assert.equal(await panel.getByRole("checkbox", { name: /正投影/ }).isChecked(), false);
  await panel.getByRole("checkbox", { name: "投影法", exact: true }).check();
  assert.ok(await panel.getByRole("checkbox", { name: /正投影/ }).isChecked());
  assert.equal(await panel.getByRole("checkbox", { name: /视图与剖面/ }).isChecked(), false);
  await format(panel, 4, "横向");
  const picked = path.join(temp, `${mode}-picked.pdf`);
  const pickedDoc = await getPdf(page, panel, "下载所选", picked, "正投影.pdf");
  assert.equal(pickedDoc.getPageCount(), 2);
  assert.ok(pickedDoc.getPage(0).getWidth() > pickedDoc.getPage(0).getHeight());
  assert.equal(fixture.requests.some(({ url }) => url.pathname.startsWith("/fixture/assets/202/")), false);
  const rendered = path.join(temp, `${mode}-4up`);
  execFileSync("pdftoppm", ["-png", "-r", "72", "-f", "1", "-l", "1", picked, rendered]);
  const image = PNG.sync.read(await fs.readFile(`${rendered}-1.png`));
  expectRenderedColor(image, 0.25, 0.25, 0);
  expectRenderedColor(image, 0.75, 0.25, 1);
  expectRenderedColor(image, 0.25, 0.75, 2);
  expectRenderedColor(image, 0.75, 0.75, 3);
  const original = makeImage(0);
  assert.ok((await fs.readFile(picked)).includes(original), "JPEG embedded without re-encoding");
}

async function verifyZip(page, panel, button, filename, expectedName, expectedEntries) {
  assert.equal(await getFile(page, control(panel, button), filename), expectedName);
  const zip = await JSZip.loadAsync(await fs.readFile(filename));
  const entries = Object.values(zip.files).filter((file) => !file.dir);
  assert.equal(entries.length, expectedEntries.length);
  const prefixes = new Set();
  for (const [index, entry] of entries.entries()) {
    const parsed = /^(\d+) (.+)\.pdf$/.exec(entry.name);
    assert.ok(parsed, entry.name);
    const [position, title, pages] = expectedEntries[index];
    assert.equal(Number(parsed[1]), position);
    assert.equal(parsed[2], title);
    prefixes.add(parsed[1].length);
    const doc = await PDFDocument.load(await entry.async("uint8array"));
    assert.equal(doc.getPageCount(), pages, entry.name);
    assert.ok(doc.getPage(0).getHeight() > doc.getPage(0).getWidth(), entry.name);
  }
  assert.equal(prefixes.size, 1);
}

async function verifySeparateFiles(mode, temp, page, panel, fixture) {
  await format(panel, 2, "竖向");
  const entries = [[1, "正投影", 3], [2, "视图与剖面", 2]];
  await verifyZip(page, panel, "下载全部", path.join(temp, `${mode}-all.zip`), "工程绘图.zip", entries);
  assert.equal(fixture.requests.filter(({ url }) => url.pathname.startsWith("/fixture/assets/202/")).length, 3);
  await control(panel, "全选").click();
  await verifyZip(page, panel, "下载所选", path.join(temp, `${mode}-selected.zip`), "工程绘图.zip", entries);
}

async function verifySiteDenial(mode, temp, page, panel, fixture) {
  const priorLessonAssets = fixture.requests.filter(({ url }) => url.pathname.startsWith("/fixture/assets/202/")).length;
  fixture.deny();
  const filename = path.join(temp, `${mode}-partial.zip`);
  await verifyZip(page, panel, "下载全部", filename, "工程绘图（部分）.zip", [[1, "正投影", 3]]);
  assert.match(await panel.getByRole("status").textContent(), /部分文件.*1\/2/);
  await panel.getByText("查看失败条目", { exact: true }).click();
  assert.match(await panel.getByRole("listitem").textContent(), /视图与剖面.*拒绝访问/);
  const currentLessonAssets = fixture.requests.filter(({ url }) => url.pathname.startsWith("/fixture/assets/202/")).length;
  assert.equal(currentLessonAssets, priorLessonAssets);
}

function downloadDestination(panel) {
  return panel.getByRole("combobox", { name: "下载地址", exact: true });
}

async function mockSaveFilePicker(page) {
  await page.addInitScript(() => {
    window.showSaveFilePicker = async ({ suggestedName }) => {
      const selection = { suggestedName, closed: false };
      window.fixtureSavedFile = selection;
      return {
        async createWritable() {
          return {
            async write(blob) {
              selection.type = blob.type;
              selection.bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
            },
            async close() {
              selection.closed = true;
            },
          };
        },
      };
    };
  });
}

async function verifyDownloadDestination(mode, temp, page, previousPanel) {
  await downloadDestination(previousPanel).selectOption("choose");
  const panel = await startPanel(page, mode);
  assert.equal(await downloadDestination(panel).inputValue(), "choose");
  await format(panel, 2, "竖向");
  await panel.getByRole("checkbox", { name: /正投影/ }).check();
  const saveLink = panel.getByRole("link", { name: "保存文件", exact: true });
  const automaticDownloads = [];
  const record = (download) => automaticDownloads.push(download.suggestedFilename());
  page.on("download", record);
  try {
    await control(panel, "下载所选").click();
    await saveLink.waitFor();
    await assert.rejects(page.waitForEvent("download", { timeout: 350 }), { name: "TimeoutError" });
    assert.deepEqual(automaticDownloads, [], "Manual destination should wait for user interaction");
  } finally {
    page.off("download", record);
  }

  const filename = await saveLink.getAttribute("download");
  assert.equal(filename, "正投影.pdf");
  const picker = control(panel, "选择保存位置");
  let pickerBytes;
  if (mode === "userscript") {
    await picker.click();
    await page.waitForFunction(() => window.fixtureSavedFile?.closed);
    const savedFile = await page.evaluate(() => window.fixtureSavedFile);
    assert.equal(savedFile.suggestedName, filename);
    assert.equal(savedFile.type, "application/pdf");
    pickerBytes = Buffer.from(savedFile.bytes);
  } else if (!(await page.evaluate(() => typeof window.showSaveFilePicker === "function"))) {
    assert.equal(await picker.count(), 0);
  }

  const destination = path.join(temp, `${mode}-manual.pdf`);
  assert.equal(await getFile(page, saveLink, destination), filename);
  const savedBytes = await fs.readFile(destination);
  assert.equal((await PDFDocument.load(savedBytes)).getPageCount(), 3);
  if (pickerBytes) assert.deepEqual(pickerBytes, savedBytes);
}

async function runMode(mode, temp) {
  const profile = path.join(temp, mode);
  const args = ["--host-resolver-rules=MAP * ~NOTFOUND", "--disable-background-networking"];
  if (mode === "extension") {
    args.push(`--disable-extensions-except=${extension}`, `--load-extension=${extension}`);
  }
  const runner = mode === "webkit" ? webkit : chromium;
  const browserOptions = mode === "webkit" ? {} : { channel: "chromium", args };
  const context = await runner.launchPersistentContext(profile, {
    ...browserOptions, headless: true, acceptDownloads: true,
  });
  try {
    if (mode === "webkit") await verifySessionTransport(context);
    const fixture = await attachFixture(context);
    const page = context.pages()[0] || await context.newPage();
    if (mode === "userscript") await mockSaveFilePicker(page);
    page.setDefaultTimeout(12000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const panel = await startPanel(page, mode);
    assert.equal(await downloadDestination(panel).inputValue(), "browser");
    assert.equal(await label(panel, "输出方式").count(), 0);
    await verifyPlacedImages(mode, temp, page, panel, fixture);
    await verifySeparateFiles(mode, temp, page, panel, fixture);
    await verifySiteDenial(mode, temp, page, panel, fixture);
    const secondCourse = label(panel, "课程");
    await optionByText(secondCourse, "材料力学");
    await panel.getByText("应力分析", { exact: true }).waitFor();
    assert.equal(await panel.getByText("正投影", { exact: true }).count(), 0);
    await format(panel, 1, "横向");
    const second = await getPdf(page, panel, "下载全部", path.join(temp, `${mode}-second.pdf`), "应力分析.pdf");
    assert.equal(second.getPageCount(), 5);
    assert.ok(second.getPage(0).getWidth() > second.getPage(0).getHeight());
    await verifyDownloadDestination(mode, temp, page, panel);
    if (mode !== "webkit") {
      assert.ok(fixture.requests.some(({ url, headers }) => (
        url.pathname === "/v2/api/web/courses/list" && headers.cookie?.includes(sessionCookie)
      )));
    }
    assert.ok(fixture.requests.every(({ url, headers }) => url.origin !== cdn || !headers.cookie));
    assert.deepEqual(fixture.unexpected, []);
    assert.deepEqual(pageErrors, []);
    console.log(`${mode}: courses, individual PDFs, ordered ZIPs, layouts, default/manual saving, original JPEG, and 403 pass`);
  } finally {
    await context.close();
  }
}

async function main() {
  const mode = process.argv[2] || "both";
  assert.ok(["extension", "userscript", "both", "webkit"].includes(mode), "Use extension, userscript, both, or webkit");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ykt-browser-"));
  try {
    for (const target of mode === "both" ? ["extension", "userscript"] : [mode]) await runMode(target, temp);
  } finally {
    if (process.env.YKT_KEEP_FIXTURES) {
      console.log(`Fixture files: ${temp}`);
    } else {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
