import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const defaultOutputDirectory = resolve(projectRoot, "dist");
const publicFiles = [
  "index.html",
  "app.js",
  "styles.css",
  "manifest.webmanifest",
  "sw.js",
  "icons/app.svg",
  "icons/app-192.png",
  "icons/app-512.png",
];

export async function buildSite(outputDirectory = defaultOutputDirectory) {
  if (resolve(outputDirectory) === defaultOutputDirectory) {
    await rm(defaultOutputDirectory, { recursive: true, force: true });
  }
  await mkdir(outputDirectory, { recursive: true });
  for (const file of publicFiles) {
    const destination = resolve(outputDirectory, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(projectRoot, file), destination);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
}
