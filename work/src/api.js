(() => {
  "use strict";

  const UNCATEGORIZED = "未分类教学活动";
  const WEB = "/v2/api/web";
  const LOG_PAGE_SIZE = 20;

  function id(value) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
    const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
    return /^[1-9]\d*$/.test(text) ? text : "";
  }

  function name(...values) {
    return values.find(value => typeof value === "string" && value.trim())?.trim() || "";
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function route(url = location.href) {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/v2\/web\/(?:studentLog|student-lesson-report|student-v3|studentCards|student)\/(\d+)(?:\/|$)/);
    const classroomId = id(match?.[1]);
    if (!classroomId) return null;
    return {
      id: classroomId,
      title: `当前班级 ${classroomId}`,
      universityId: id(parsed.searchParams.get("university_id") || parsed.searchParams.get("uv_id")),
      platformId: id(parsed.searchParams.get("platform_id"))
    };
  }

  function params(path, values) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    }
    return query.size ? `${path}?${query}` : path;
  }

  function parseData(response, action, plain = false) {
    if (!response || typeof response !== "object") throw new Error(`${action}，未收到有效响应`);
    const code = response.errcode ?? response.code;
    if (response.success === false || (code != null && code !== 0 && code !== "0")) {
      const message = name(response.errmsg, response.msg, response.message).slice(0, 140);
      const auth = [401, 403].includes(Number(code)) || /权限|登录|未开放|禁止|unauthorized|forbidden|login/i.test(message);
      const error = new Error(`${action}${message ? `：${message}` : code == null ? "" : `（${code}）`}`);
      if (auth) error.status = Number(code) === 401 || /登录|login/i.test(message) ? 401 : 403;
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(response, "data")) return response.data;
    if (plain) return response;
    throw new Error(`${action}，响应缺少数据`);
  }

  function locked(item) {
    return [true, 1, "1"].includes(item?.is_locked) ||
      [true, 1, "1"].includes(item?.time_info?.is_locked) ||
      [false, 0, "0"].includes(item?.time_info?.is_show) ||
      Boolean(name(item?.locked_reason));
  }

  function blocked(record) {
    return locked(record) ||
      [record?.allow_download, record?.can_download, record?.downloadable, record?.Downloadable, record?.CanDownload]
        .some(value => [false, 0, "0"].includes(value)) ||
      [true, 1, "1"].includes(record?.prohibit_download);
  }

  function assertDownloadable(...records) {
    if (records.some(blocked)) {
      throw new Error("课程资料尚未开放或不允许下载");
    }
  }

  function asset(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, globalThis.location?.origin || "https://www.yuketang.cn");
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch {
      return "";
    }
    return "";
  }

  function imageUrls(records, hidden = new Set()) {
    return list(records)
      .filter(slide => slide && !hidden.has(id(slide.id)) &&
        ![false, 0, "0"].includes(slide.visible) && !slide.notVisible && !locked(slide))
      .map((slide, order) => ({
        url: asset(slide.cover || slide.Cover),
        index: Number(slide.index ?? slide.Index ?? slide.PageIndex ?? order)
      }))
      .filter(slide => slide.url)
      .sort((first, second) => first.index - second.index)
      .map(slide => slide.url);
  }

  function collectLeaves(chapters) {
    const leaves = [];
    const seen = new Set();
    function walk(node, group) {
      if (!node || locked(node)) return;
      const type = Number(node.leaf_type);
      const leafId = id(node.id);
      if (leafId && [7, 8, 14].includes(type) && !seen.has(leafId)) {
        seen.add(leafId);
        leaves.push({
          key: `leaf:${leafId}`,
          id: id(node.courseware_id),
          leafId,
          title: name(node.name, node.title) || `课件 ${leafId}`,
          group,
          kind: type === 8 ? "lesson" : "deck",
          downloadable: !blocked(node)
        });
      }
      const children = node.section_leaf_list ?? [...list(node.section_list), ...list(node.leaf_list)];
      for (const child of list(children)) walk(child, group);
    }
    for (const chapter of list(chapters)) walk(chapter, name(chapter.name, chapter.title) || UNCATEGORIZED);
    return leaves;
  }

  function create({ request }) {
    const contexts = new Map();

    async function get(path, values, course, signal, action, plain = false) {
      const headers = { xtbz: "ykt" };
      if (course?.id) headers["classroom-id"] = course.id;
      if (course?.universityId) {
        headers["university-id"] = course.universityId;
        headers["uv-id"] = course.universityId;
      }
      const query = course?.id ? { ...values, classroom_id: course.id } : values;
      return parseData(await request(params(path, query), { headers, signal }), action, plain);
    }

    async function courses(current, signal) {
      const data = await get(`${WEB}/courses/list`, { identity: 2 }, null, signal, "读取课程失败");
      if (!Array.isArray(data?.list)) throw new Error("无法读取课程列表，请确认已登录雨课堂");
      const result = new Map();
      for (const entry of data.list) {
        const classroomId = id(entry?.classroom_id);
        if (!classroomId) continue;
        const course = entry.course || {};
        const context = classroomId === current?.id ? current : {};
        const title = name(course.name, entry.course_name, entry.name, context.title) || `班级 ${classroomId}`;
        const subtitle = name(entry.classroom_name, entry.name);
        result.set(classroomId, {
          id: classroomId,
          title,
          ...(subtitle && subtitle !== title ? { subtitle } : {}),
          universityId: id(entry.classroom_university_id ?? entry.university_id ?? course.university_id) || context.universityId || "",
          platformId: id(entry.platform_id ?? course.platform) || context.platformId || "",
          courseSign: name(entry.course_sign, course.sign)
        });
      }
      if (current?.id && !result.has(current.id)) return [current, ...result.values()];
      return Array.from(result.values());
    }

    async function classroomContext(course, signal) {
      if (course.courseSign && course.universityId) return course;
      const cached = contexts.get(course.id);
      if (cached) return { ...course, ...cached };
      const detail = await get(`${WEB}/classrooms/${course.id}`, { role: 5 }, course, signal, "读取班级信息失败");
      const context = {
        universityId: id(detail?.uv_id ?? detail?.university_id) || course.universityId,
        platformId: id(detail?.platform ?? detail?.platform_id) || course.platformId,
        courseSign: name(detail?.course_sign, course.courseSign)
      };
      contexts.set(course.id, context);
      return { ...course, ...context };
    }

    async function activityItems(course, signal) {
      const result = new Map();
      for (let page = 0; page < 500; page++) {
        const data = await get(`${WEB}/logs/learn/${course.id}`,
          { actype: -1, page, offset: LOG_PAGE_SIZE, sort: -1 }, course, signal, "读取学习日志失败");
        if (!Array.isArray(data?.activities)) throw new Error("学习日志未返回活动列表");
        for (const activity of data.activities) {
          const activityType = Number(activity?.type);
          const entryId = id(activity?.courseware_id);
          if (!entryId || ![2, 14].includes(activityType) || locked(activity) ||
              (activityType === 14 && [false, 0, "0"].includes(activity.is_finished))) continue;
          const kind = activityType === 14 ? "lesson" : "deck";
          const key = `${kind}:${entryId}`;
          if (!result.has(key)) {
            const pages = Number(activity.count);
            result.set(key, {
              key,
              id: entryId,
              leafId: id(activity.content?.leaf_id ?? activity.leaf_id),
              title: name(activity.title, activity.name) || `课件 ${entryId}`,
              group: name(activity.chapter_name, activity.content?.chapter_name) || UNCATEGORIZED,
              kind,
              downloadable: !blocked(activity) && !blocked(activity.content),
              ...(kind === "deck" && Number.isSafeInteger(pages) && pages > 0 ? { pages } : {})
            });
          }
        }
        if (!data.has_more || data.activities.length === 0) return Array.from(result.values());
      }
      throw new Error("学习日志超过可读取的页数，请按章节筛选");
    }

    async function chapterItems(course, signal) {
      const context = await classroomContext(course, signal);
      const data = await get("/mooc-api/v1/lms/learn/course/chapter",
        { cid: context.id, sign: context.courseSign, uv_id: context.universityId }, context, signal, "读取课程章节失败");
      return collectLeaves(data?.course_chapter);
    }

    async function items(course, signal) {
      const [chapters, activities] = await Promise.allSettled([
        chapterItems(course, signal), activityItems(course, signal)
      ]);
      if (signal?.aborted) throw signal.reason || new DOMException("已取消", "AbortError");
      if (chapters.status === "rejected" && activities.status === "rejected") throw activities.reason;
      const catalog = chapters.status === "fulfilled" ? chapters.value : [];
      const logs = activities.status === "fulfilled" ? activities.value : [];
      const logByLeaf = new Map(logs.filter(item => item.leafId).map(item => [item.leafId, item]));
      const logByKey = new Map(logs.map(item => [item.key, item]));
      const titleKey = item => `${item.kind}:${item.title}`;
      function uniqueTitles(entries) {
        const titles = new Map();
        for (const entry of entries) {
          const key = titleKey(entry);
          titles.set(key, titles.has(key) ? null : entry);
        }
        return titles;
      }
      const chapterTitles = uniqueTitles(catalog);
      const logTitles = uniqueTitles(logs);
      const found = new Set();
      const result = catalog.map(item => {
        const identifiedLog = logByLeaf.get(item.leafId) || logByKey.get(`${item.kind}:${item.id}`);
        const titledLog = !item.id && chapterTitles.get(titleKey(item)) === item && logTitles.get(titleKey(item));
        const log = identifiedLog || titledLog;
        if (!log || log.kind !== item.kind) return item;
        found.add(log.key);
        const canonical = identifiedLog ? log : item;
        return { ...canonical, title: item.title, group: item.group, downloadable: item.downloadable && log.downloadable };
      });
      return [...result, ...logs.filter(item => !found.has(item.key))];
    }

    async function lessonSlides(course, lessonId, signal) {
      const values = { lesson_id: lessonId };
      const info = await get("/api/v3/classroom-report/student/lesson-info", values,
        course, signal, "读取课堂信息失败");
      assertDownloadable(info);
      let presentations = list(info?.presentationIds).map(value => ({ id: value }));
      if (info?.oldVersion) {
        const summary = await get("/api/v3/lesson-summary/student", values, course, signal, "读取课堂课件列表失败");
        if (Number(summary?.errorCode) === -1) throw new Error("课堂报告正在生成，请稍后重试");
        assertDownloadable(summary, summary?.lesson);
        presentations = list(summary?.presentations);
      }
      const slides = [];
      for (const presentation of presentations) {
        const presentationId = id(presentation?.id);
        if (!presentationId || presentation.conf?.show_presentation === "all_not") continue;
        assertDownloadable(presentation, presentation.conf);
        const data = await get("/api/v3/lesson-summary/student/presentation",
          { ...values, presentation_id: presentationId }, course, signal, "读取课堂课件失败");
        const configurations = [presentation.conf, data?.presentation?.conf].filter(Boolean);
        assertDownloadable(data, data?.presentation, ...configurations);
        if (configurations.some(conf => conf.show_presentation === "all_not" ||
            (conf.show_presentation === "part" && !Array.isArray(conf.hide_slides)))) continue;
        const hidden = new Set(configurations.flatMap(conf => list(conf.hide_slides).map(id)).filter(Boolean));
        slides.push(...imageUrls(data?.slides, hidden));
      }
      return slides;
    }

    async function deckSources(course, deckId, signal) {
      const permission = await get(`/cards/view_permission/${deckId}/`, {}, course, signal, "检查课件权限失败");
      if (!permission || permission === "0" || permission?.allowed === false || permission?.view_permission === false) {
        throw new Error("课件当前未对学生开放");
      }
      assertDownloadable(permission);
      const data = await get(`${WEB}/cards/detlist/${deckId}`, {}, course, signal, "读取课件详情失败");
      assertDownloadable(data);
      return {
        native: asset(data?.PdfUrl || data?.pdf_url || data?.pdfUrl) || undefined,
        slides: imageUrls(data?.Slides)
      };
    }

    async function sources(course, item, signal) {
      assertDownloadable(item);
      const context = { ...course, ...contexts.get(course.id) };
      let targetId = item.id;
      if (!targetId && item.leafId) {
        const leaf = await get("/edu_admin/leaf_level_info/", { leaf_level_id: item.leafId },
          context, signal, "读取章节资料失败", true);
        assertDownloadable(leaf);
        if ((id(leaf?.classroom_id) && id(leaf.classroom_id) !== course.id) ||
            (item.kind === "lesson" && Number(leaf?.lesson_tatus) === 1)) {
          throw new Error("该资料暂未开放");
        }
        targetId = id(leaf?.courseware_id);
      }
      if (!targetId) throw new Error("缺少课件编号");
      const result = item.kind === "lesson"
        ? { slides: await lessonSlides(context, targetId, signal) }
        : await deckSources(context, targetId, signal);
      if (!result.native && !result.slides.length) throw new Error("此活动没有公开的幻灯片");
      return result;
    }

    return { courses, items, sources };
  }

  globalThis.YktApi = { route, create };
})();
