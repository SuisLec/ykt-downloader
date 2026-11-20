import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const work = dirname(fileURLToPath(import.meta.url));
const source = join(work, "src");
const outputs = resolve(work, "../outputs");
const projectLicense = await readFile(resolve(work, "../LICENSE"), "utf8");
const extension = join(outputs, "ykt-downloader");
const require = createRequire(import.meta.url);
const archive = new JSZip();
const archiveRoot = archive.folder("ykt-downloader");
const app = ["api.js", "pdf.js", "download.js", "panel.js"];
const vendors = [
  { name: "pdf-lib", script: "pdf-lib.min.js", license: "LICENSE.md" },
  { name: "jszip", script: "jszip.min.js", license: "LICENSE.markdown" },
];

async function writeExtension(filename, contents) {
  await writeFile(join(extension, filename), contents);
  archiveRoot.file(filename, contents);
}

await mkdir(join(extension, "lib"), { recursive: true });
await writeExtension("manifest.json", await readFile(join(source, "ext/manifest.json"), "utf8"));
await writeExtension("LICENSE.txt", projectLicense);
const parts = [await readFile(join(source, "userscript-header.txt"), "utf8")];
for (const vendor of vendors) {
  const vendorDir = dirname(require.resolve(`${vendor.name}/package.json`));
  const original = await readFile(join(vendorDir, "dist", vendor.script), "utf8");
  const script = original.replace(/^\/\/# sourceMappingURL=.*$/gm, "").trimEnd();
  const license = await readFile(join(vendorDir, vendor.license), "utf8");
  await writeExtension(`lib/${vendor.script}`, `${script}\n`);
  await writeExtension(`lib/${vendor.name}-LICENSE.txt`, license);
  parts.push(`/*\n${license.replaceAll("*/", "* /")}\n*/\n;(function () {\nconst module = undefined, exports = undefined, define = undefined;\n${script}\n}).call(globalThis);`);
}

for (const filename of app) {
  const script = await readFile(join(source, filename), "utf8");
  await writeExtension(filename, script);
  parts.push(`;\n${script}`);
}
parts.push(`/*\n${projectLicense}*/\n`);
await writeFile(join(outputs, "ykt-downloader.user.js"), `${parts.join("\n\n")}\n`);
const zip = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
await writeFile(join(outputs, "ykt-downloader-chrome-edge.zip"), zip);
