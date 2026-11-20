(() => {
  "use strict";

  const slideConcurrency = 6;
  const metadataConcurrency = 3;

  function abortCheck(signal) {
    if (signal?.aborted) throw signal.reason || new DOMException("已取消", "AbortError");
  }

  function wait(delay, signal) {
    abortCheck(signal);
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason || new DOMException("已取消", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, delay);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  function parseJson(text) {
    const values = /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/gs;
    return JSON.parse(text.replace(values, (value) =>
      /^-?\d{16,}$/.test(value) && !Number.isSafeInteger(Number(value)) ? `"${value}"` : value));
  }

  async function fetchData(url, { signal, headers, binary = false }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      abortCheck(signal);
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timer = setTimeout(abort, binary ? 45000 : 16000);
      signal?.addEventListener("abort", abort, { once: true });
      let pause = 500 * 2 ** attempt;
      try {
        const response = await fetch(url, {
          headers,
          mode: binary ? "cors" : "same-origin",
          credentials: url.origin === location.origin ? "same-origin" : "omit",
          signal: controller.signal,
        });
        if (!response.ok) {
          const status = response.status;
          const message = status === 401 ? "登录已失效，请重新登录雨课堂"
            : status === 403 ? "雨课堂拒绝访问该内容"
              : status === 429 ? "雨课堂请求过多，请稍后重试"
                : `雨课堂请求失败（HTTP ${status}）`;
          const error = Object.assign(new Error(message), {
            status, retryable: status === 429 || status >= 500,
          });
          const retryAfter = response.headers.get("retry-after");
          if (retryAfter && status === 429) {
            const delay = /^\d+$/.test(retryAfter)
              ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
            if (delay > 15000) error.retryable = false;
            else if (delay > 0) pause = Math.max(delay, pause);
          }
          throw error;
        }
        if (binary) return new Uint8Array(await response.arrayBuffer());
        try {
          return parseJson(await response.text());
        } catch (error) {
          if (controller.signal.aborted || error instanceof TypeError) throw error;
          throw new Error("雨课堂返回了非 JSON 页面，建议检查是否仍处于登录状态");
        }
      } catch (error) {
        abortCheck(signal);
        const retryable = error.retryable || error instanceof TypeError || controller.signal.aborted;
        if (!retryable) throw error;
        if (attempt === 2) {
          if (controller.signal.aborted) throw new Error("请求超时，请重试");
          if (error instanceof TypeError) {
            throw new Error(binary ? "浏览器无法读取该课件文件，可能是网络或跨域限制" : "无法连接雨课堂，请检查网络");
          }
          throw error;
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
      await wait(pause, signal);
    }
  }

  function request(path, { headers, signal } = {}) {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin) throw new Error("无效的雨课堂接口");
    return fetchData(url, { headers: { Accept: "application/json", ...headers }, signal });
  }

  function getBytes(source, signal) {
    const url = new URL(source, location.href);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("课件链接无效");
    }
    return fetchData(url, { signal, binary: true });
  }

  function fileName(value, limit = 60) {
    const cleaned = String(value || "")
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
      .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[. ]+|[. ]+$/g, "");
    const basename = [...cleaned].slice(0, limit).join("").trim() || "课件";
    const firstPart = basename.split(".")[0].trimEnd();
    return /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(firstPart)
      ? `课件-${basename}` : basename;
  }

  async function run(api, course, items, options, signal, progress) {
    const courseName = fileName(course.title);
    const files = [];
    const issues = [];
    const pending = new Map();
    let complete = 0;
    let slidesWritten = 0;
    const report = (message, position) => progress(message, position / items.length);
    const batch = items.length > 1;
    const filenameDigits = String(items.length).length;

    function prepare(index) {
      if (index >= items.length || signal.aborted) return;
      const source = Promise.resolve().then(() => api.sources(course, items[index], signal));
      pending.set(index, source.then((value) => ({ value }), (error) => ({ error })));
    }

    try {
      for (let index = 0; index < metadataConcurrency; index += 1) prepare(index);
      for (const [index, item] of items.entries()) {
        abortCheck(signal);
        report(`正在读取 ${index + 1}/${items.length} · ${item.title}`, index);
        const { value: sources, error: sourceError } = await pending.get(index);
        pending.delete(index);
        prepare(index + metadataConcurrency);
        abortCheck(signal);
        if (sourceError) {
          issues.push({ title: item.title, reason: sourceError.message || "无法读取课件" });
          continue;
        }

        const builder = await globalThis.YktPdf.create({ ...options, title: item.title });
        const previousIssues = issues.length;
        try {
          if (sources.native) {
            report(`正在获取原版 PDF · ${item.title}`, index);
            try {
              await builder.addPdf(await getBytes(sources.native, signal), signal);
            } catch (error) {
              abortCheck(signal);
              if ([401, 403, 429].includes(error.status) ||
                  builder.slideCount || !sources.slides?.length) throw error;
            }
          }
          if (!builder.slideCount && sources.slides?.length) {
            let missing = 0;
            let reason = "";
            for (let offset = 0; offset < sources.slides.length; offset += slideConcurrency) {
              const links = sources.slides.slice(offset, offset + slideConcurrency);
              let fetched = 0;
              const outcomes = await Promise.allSettled(links.map(async (url) => {
                try {
                  return await getBytes(url, signal);
                } finally {
                  fetched += 1;
                  const done = offset + fetched;
                  report(`${item.title} · ${done}/${sources.slides.length} 张`,
                    index + 0.9 * done / sources.slides.length);
                }
              }));
              abortCheck(signal);
              const images = [];
              for (const outcome of outcomes) {
                if (outcome.status === "fulfilled") images.push(outcome.value);
                else {
                  missing += 1;
                  reason ||= outcome.reason.message;
                }
              }
              if (images.length) {
                try {
                  await builder.addSlides(images, signal);
                } catch (error) {
                  abortCheck(signal);
                  issues.push({ title: item.title, reason: error.message || "部分图片无法写入 PDF" });
                }
              }
            }
            if (missing) issues.push({ title: item.title, reason: `${missing} 张获取失败。${reason}` });
          }
          if (!builder.slideCount && issues.length === previousIssues) {
            throw new Error("未能写入任何课件页面");
          }
        } catch (error) {
          abortCheck(signal);
          issues.push({ title: item.title, reason: error.message || "导出失败" });
        }
        if (!builder.slideCount) continue;

        const prefix = batch ? `${String(index + 1).padStart(filenameDigits, "0")} ` : "";
        const partial = issues.length > previousIssues ? "（部分）" : "";
        const name = `${prefix}${fileName(item.title)}${partial}.pdf`;
        try {
          const bytes = await builder.save(signal);
          files.push({ bytes, name });
        } catch (error) {
          abortCheck(signal);
          issues.push({ title: item.title, reason: error.message || "保存 PDF 失败" });
          continue;
        }
        slidesWritten += builder.slideCount;
        if (issues.length === previousIssues) complete += 1;
      }

      abortCheck(signal);
      if (!files.length) return { issues, complete, slidesWritten: 0 };
      if (!batch) {
        const [{ name, bytes }] = files;
        return {
          filename: name, blob: new Blob([bytes], { type: "application/pdf" }),
          complete, slidesWritten, issues,
        };
      }
      report("正在封装文件…", items.length);
      const partial = issues.length ? "（部分）" : "";
      const archive = new globalThis.JSZip();
      for (const { name, bytes } of files) archive.file(name, bytes);
      const blob = await archive.generateAsync({ type: "blob", compression: "STORE", streamFiles: true }, (status) => {
        abortCheck(signal);
        report(`正在打包 ${Math.floor(status.percent)}%`, items.length);
      });
      abortCheck(signal);
      return { filename: `${courseName}${partial}.zip`, blob, complete, slidesWritten, issues };
    } finally {
      pending.clear();
    }
  }

  globalThis.YktDownload = { request, run };
})();
