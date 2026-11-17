// 仅供 Node 逻辑测试使用：把无扩展名的相对导入补成 .ts（Vite 构建不受影响）
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[a-zA-Z0-9]+$/.test(specifier)
  ) {
    const base = new URL(specifier, context.parentURL);
    const candidates = [base.href + ".ts", new URL(specifier + "/index.ts", context.parentURL).href];
    for (const href of candidates) {
      if (existsSync(fileURLToPath(href))) {
        return nextResolve(pathToFileURL(fileURLToPath(href)).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
