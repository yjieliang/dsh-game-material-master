import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const OUT = (process.argv[2] ?? fileURLToPath(new URL("../.preview/", import.meta.url))).replace(/[\\/]+$/, "") + "/";
mkdirSync(OUT, { recursive: true });

// 样式表是 TS（多文件拼接），用 esbuild 打成临时 ESM 再 import，不依赖构建产物布局。
const STYLES_ENTRY = fileURLToPath(new URL("../src/client/styles.ts", import.meta.url));
await build({ entryPoints: [STYLES_ENTRY], bundle: true, format: "esm", platform: "node", outfile: OUT + "styles.mjs", logLevel: "error" });
const { CSS } = await import(pathToFileURL(OUT + "styles.mjs").href);

const navItems = [
  ["sprite", "动画帧工具盒", "角色设定图到行走精灵", true],
  ["image", "图片生成", "单张设定图 / 立绘", false],
  ["sequence", "序列帧生成", "动作视频到序列帧", false],
  ["rig", "骨骼动画生成", "拆件与骨骼绑定", false, true],
  ["iso", "45° 地图编辑器", "等距地块与物件", false],
  ["map", "俯视地图编辑器", "自动连接与标记", false],
  ["music", "音乐生成编辑", "灵感 / 谱曲 / 导出", false],
  ["sfx", "音效生成", "一句话生成音效", false],
];
const steps = ["八方向绿幕图", "行走动作视频", "提取序列帧", "合成精灵整图", "行走预览"];

const nav = navItems
  .map(([key, title, hint, active, experimental]) => `
        <button type="button" class="SPR_navItem" data-module="${key}" data-active="${active ? "true" : "false"}">
          <span class="SPR_navTitleRow"><span class="SPR_navTitle">${title}</span>${experimental ? '<span class="SPR_navFlag">· 实验</span>' : ""}</span>
          ${active ? `<span class="SPR_navHint">${hint}</span>` : ""}
        </button>`)
  .join("");

const stepBar = steps
  .map((label, index) => `
          <button type="button" class="SPR_stepCard" data-stage="s${index}" data-active="${index === 0 ? "true" : "false"}" data-done="false">
            <span class="SPR_stepNum">${String(index + 1).padStart(2, "0")}</span>
            <span class="SPR_stepLabel">${label}</span>
          </button>`)
  .join("");

const tips = ["正面全身，四肢完整无遮挡", "纯色背景，轮廓清晰", "不添加文字、水印或场景道具"]
  .map((text, index) => `<li class="SPR_tip"><span class="SPR_tipNo">0${index + 1}</span><span class="SPR_tipText">${text}</span></li>`)
  .join("");

const railRows = [["当前阶段", "八方向绿幕图"], ["输出规格", "8 方向 × 8 帧"], ["审核方式", "自动审核"]]
  .map(([label, value]) => `<div class="SPR_railRow"><span class="SPR_railLabel">${label}</span><span class="SPR_railValue">${value}</span></div>`)
  .join("");

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>墨盒 · UI 预览</title>
<style>
html,body{margin:0;height:100%;background:#f7f5f0}
#root{height:100%}
${CSS}
</style></head><body><div id="root">
<div class="SPR_root" data-gmm-theme="light">
  <div class="SPR_app">
    <aside class="SPR_sidebar">
      <div class="SPR_brand">
        <span class="SPR_brandMark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <div class="SPR_brandText"><span class="SPR_brandTitle">墨盒</span><span class="SPR_brandSub">AI 游戏资产工作台</span></div>
      </div>
      <button type="button" class="SPR_newProject">新建项目</button>
      <div class="SPR_sideGroup">创作工具</div>
      <nav class="SPR_nav" aria-label="创作工具">${nav}</nav>
      <details class="SPR_sideProjWrap">
        <summary class="SPR_sideProject">
          <span class="SPR_sideProjectLabel">当前项目</span>
          <span class="SPR_sideProjectName">测试 1</span>
          <span class="SPR_sideProjectMeta">八方向图 · 8 帧 · 自动审核</span>
          <span class="SPR_sideProjectState">进行中 · 步骤 1/5</span>
        </summary>
        <div class="SPR_projPop"><div class="SPR_projPopHead">项目（2）</div></div>
      </details>
    </aside>
    <div class="SPR_mainCol">
      <header class="SPR_topbar">
        <div class="SPR_crumb"><span>工作台</span><span class="SPR_crumbSep">/</span><b>动画帧工具盒</b></div>
        <span class="SPR_topSpacer"></span>
        <span class="SPR_topStatus"><i></i>本地处理已连接</span>
      </header>
      <div class="SPR_scroll">
        <div class="SPR_pageHead">
          <div class="SPR_pageHeadMain">
            <h1 class="SPR_pageTitle">动画帧工具盒</h1>
            <p class="SPR_pageSub">从一张角色设定图，生成可直接用于游戏的八方向行走素材。</p>
          </div>
          <div class="SPR_pageActions"></div>
        </div>
        <div class="SPR_stepBar" role="tablist">${stepBar}</div>
        <div class="SPR_cols">
          <div class="SPR_col">
            <div class="SPR_panel">
              <div class="SPR_panelHead">
                <div class="SPR_panelHeadMain">
                  <h2 class="SPR_panelTitle">八方向绿幕图</h2>
                  <p class="SPR_panelSub">生成同源的八个方向，保持角色造型、光线与画风一致。</p>
                </div>
                <div class="SPR_panelHeadAside"><span class="SPR_chip">等待源图</span></div>
              </div>
              <div class="SPR_panelBody">
                <div class="SPR_sourceBlock">
                  <button type="button" class="SPR_dropZone" data-over="false" data-has="false">
                    <span class="SPR_dropIcon"></span>
                    <span class="SPR_dropTitle">拖入角色设定图</span>
                    <span class="SPR_dropSub">PNG / JPG / WebP，最大 20 MB</span>
                    <span class="SPR_dropPick">选择图片</span>
                  </button>
                  <div class="SPR_tips">
                    <h4 class="SPR_tipsTitle">一张合适的源图，会减少后续返工</h4>
                    <p class="SPR_tipsText">上传后，八个方向都以这张图作为唯一角色参考。</p>
                    <ol class="SPR_tipsList">${tips}</ol>
                  </div>
                </div>
                <div class="SPR_field"><span class="SPR_fieldLabel">生成方式</span></div>
                <div class="SPR_modeBar"><span class="SPR_modeBarLabel"></span>
                  <button type="button" class="SPR_modeTag" data-active="true">转圈截帧 · 推荐</button>
                  <button type="button" class="SPR_modeTag" data-active="false">逐方向生图</button>
                </div>
                <p class="SPR_hint" style="margin:10px 0 0">先生成一段原地转圈视频，再截取八个方向。八个方向来自同一段视频，一致性更好。</p>
                <p class="SPR_hint" style="margin:16px 0 6px;color:var(--gmm-text);font-weight:600">转圈视频提示词</p>
                <textarea class="SPR_input" rows="6" style="width:100%">角色原地匀速旋转一整圈（360°），固定机位，绿幕背景。保持角色五官、发型、服装、配色与源图一致；不出现行走、抬手、点头等额外动作。</textarea>
                <div class="SPR_panelFoot" style="padding:12px 0 0">
                  <span class="SPR_panelFootNote">预计 1 次视频调用 · 约 1–6 分钟</span>
                  <span class="SPR_panelFootActions">
                    <button type="button" class="SPR_btn"><span>选择本地视频</span></button>
                    <button type="button" class="SPR_btn" data-primary="true"><span>生成转圈视频</span></button>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="SPR_col">
            <div class="SPR_railCard">
              <div class="SPR_railHead"><h3 class="SPR_railTitle">本步设置</h3></div>
              ${railRows}
            </div>
            <div class="SPR_railCard">
              <div class="SPR_railHead"><h3 class="SPR_railTitle">产出预览</h3><span class="SPR_railAside">尚未生成</span></div>
              <div class="SPR_previewBox">八方向预览</div>
              <p class="SPR_previewCaption">生成后可逐方向查看、调整截帧位置，或下载全部图片。</p>
              <p class="SPR_previewFoot">PNG 序列帧 · 本地处理</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
</div></body></html>`;

writeFileSync(OUT + "ui-preview.html", page, "utf8");
writeFileSync(OUT + "ui-preview-dark.html", page.replace('data-gmm-theme="light"', 'data-gmm-theme="dark"').replace("html,body{margin:0;height:100%;background:#f7f5f0}", "html,body{margin:0;height:100%;background:#161815}"), "utf8");
console.log("preview:", OUT + "ui-preview.html", page.length, "B");
