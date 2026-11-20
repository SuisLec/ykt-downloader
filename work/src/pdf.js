(() => {
  "use strict";

  const margin = 14;
  const gap = 12;

  function checkCanceled(signal) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("已取消", "AbortError");
    }
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function isPng(bytes) {
    return bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 &&
      bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 &&
      bytes[6] === 26 && bytes[7] === 10;
  }

  async function toPng(bytes, signal) {
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("无法解码这张幻灯片"));
        image.src = url;
      });
      checkCanceled(signal);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法转换这张幻灯片");
        context.drawImage(image, 0, 0);
        const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!png) throw new Error("无法转换这张幻灯片");
        checkCanceled(signal);
        return new Uint8Array(await png.arrayBuffer());
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function sourceBounds(page) {
    const crop = page.getCropBox();
    const media = page.getMediaBox();
    const bounds = {
      left: Math.max(crop.x, media.x),
      bottom: Math.max(crop.y, media.y),
      right: Math.min(crop.x + crop.width, media.x + media.width),
      top: Math.min(crop.y + crop.height, media.y + media.height),
    };
    if (!Object.values(bounds).every(Number.isFinite) ||
        bounds.right <= bounds.left || bounds.top <= bounds.bottom) {
      throw new Error("源 PDF 的页面尺寸无效");
    }
    return bounds;
  }

  async function create({ layout = 1, orientation = "landscape", title = "" } = {}) {
    if (![1, 2, 4].includes(layout) || !["landscape", "portrait"].includes(orientation)) {
      throw new Error("无效的 PDF 排版");
    }
    const library = globalThis.PDFLib;
    if (!library) throw new Error("PDF 组件加载失败");

    const { PDFDocument, PDFName, PageSizes, degrees } = library;
    const pdf = await PDFDocument.create();
    if (title) pdf.setTitle(title);

    const landscape = orientation === "landscape";
    const [shortSide, longSide] = PageSizes.A4;
    const paper = landscape ? [longSide, shortSide] : [shortSide, longSide];
    const columns = layout === 4 || (layout === 2 && landscape) ? 2 : 1;
    const rows = layout / columns;
    const cellWidth = (paper[0] - 2 * margin - gap * (columns - 1)) / columns;
    const cellHeight = (paper[1] - 2 * margin - gap * (rows - 1)) / rows;
    let page;
    let slot = 0;
    let slideCount = 0;

    function place(asset, rotation = 0, isImage = false) {
      if (slot === 0) page = pdf.addPage(paper);
      const column = slot % columns;
      const row = Math.floor(slot / columns);
      slot = (slot + 1) % layout;
      slideCount += 1;
      if (!asset) return;

      const sideways = rotation === 90 || rotation === 270;
      const displayWidth = sideways ? asset.height : asset.width;
      const displayHeight = sideways ? asset.width : asset.height;
      const scale = Math.min(cellWidth / displayWidth, cellHeight / displayHeight);
      const width = asset.width * scale;
      const height = asset.height * scale;
      const left = margin + column * (cellWidth + gap) + (cellWidth - displayWidth * scale) / 2;
      const top = paper[1] - margin - row * (cellHeight + gap);
      const bottom = top - cellHeight + (cellHeight - displayHeight * scale) / 2;
      const options = {
        x: left + (rotation === 180 ? width : rotation === 270 ? height : 0),
        y: bottom + (rotation === 90 ? width : rotation === 180 ? height : 0),
        width,
        height,
      };
      if (isImage) page.drawImage(asset, options);
      else page.drawPage(asset, { ...options, rotate: degrees(-rotation) });
    }

    async function addSlides(images, signal) {
      checkCanceled(signal);
      const prepared = [];
      let unreadable = 0;
      for (const bytes of images) {
        checkCanceled(signal);
        if (!(bytes instanceof Uint8Array) || !bytes.length) {
          unreadable += 1;
          continue;
        }
        let image;
        try {
          if (bytes[0] === 255 && bytes[1] === 216) {
            image = await pdf.embedJpg(bytes);
          } else {
            image = await pdf.embedPng(isPng(bytes) ? bytes : await toPng(bytes, signal));
          }
          await image.embed();
        } catch (error) {
          checkCanceled(signal);
          unreadable += 1;
          continue;
        }
        prepared.push(image);
        if (prepared.length % 4 === 0) await yieldToBrowser();
      }
      checkCanceled(signal);
      for (const image of prepared) place(image, 0, true);
      if (unreadable) throw new Error(`${unreadable} 张幻灯片图片无法读取`);
    }

    async function addPdf(bytes, signal) {
      checkCanceled(signal);
      let source;
      try {
        source = await PDFDocument.load(bytes, { updateMetadata: false });
      } catch (error) {
        checkCanceled(signal);
        throw new Error("源 PDF 损坏或受密码保护，无法重新排版", { cause: error });
      }
      checkCanceled(signal);
      const sourcePages = source.getPages();
      if (!sourcePages.length) throw new Error("源 PDF 没有页面");
      const pages = [];
      const boxes = [];
      const pageInfo = sourcePages.map((sourcePage) => {
        const rotation = ((sourcePage.getRotation().angle % 360) + 360) % 360;
        if (!sourcePage.node.Contents()) return { rotation };
        sourcePage.node.delete(PDFName.Annots);
        sourcePage.node.delete(PDFName.of("AA"));
        const index = pages.length;
        pages.push(sourcePage);
        boxes.push(sourceBounds(sourcePage));
        return { index, rotation };
      });
      const embedded = await pdf.embedPages(pages, boxes);
      for (const [index, embeddedPage] of embedded.entries()) {
        checkCanceled(signal);
        await embeddedPage.embed();
        if ((index + 1) % 8 === 0) await yieldToBrowser();
      }
      checkCanceled(signal);
      for (const { index, rotation } of pageInfo) {
        const quarterTurns = [90, 180, 270].includes(rotation) ? rotation : 0;
        place(embedded[index], quarterTurns);
      }
    }

    return {
      addSlides,
      addPdf,
      async save(signal) {
        checkCanceled(signal);
        if (!slideCount) throw new Error("没有可导出的 PDF 页面");
        const bytes = await pdf.save({
          addDefaultPage: false,
          objectsPerTick: 100,
          updateFieldAppearances: false,
        });
        checkCanceled(signal);
        return bytes;
      },
      get slideCount() {
        return slideCount;
      },
    };
  }

  globalThis.YktPdf = { create };
})();
