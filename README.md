# 高跟踩蚂蚁

手机网页小游戏：按住屏幕抬脚蓄力，松手踩下，碾碎成群的蚂蚁。纯 HTML + Canvas，不需要构建，静态托管即可运行，横屏、竖屏都能玩。

## 玩法

| 操作 | 效果 |
| --- | --- |
| 按住屏幕 | 抬脚、显示落点阴影，压力条开始蓄力（约 0.85 秒蓄满） |
| 拖动 | 移动落点（上下拖动改变前后深度） |
| 松手 | 踩下。压力越大范围越大；蓄满时为"满压"，震晕周围蚂蚁、地面开裂 |
| 按住街道上方的腿 | 原地碾压，左右拖动可以碾过去 |
| 暂停按钮 / Esc | 暂停，可结算、重开 |

计分（"自尊"）：

- 惊慌尖叫中的蚂蚁 ×2（惨叫中断）
- 受伤爬行的蚂蚁 ×1.5（补刀清理）
- 鞋跟正好扎到 ×3（鞋跟暴击）
- 满压击杀 ×2
- 连杀每 10 只额外 +50%

打破个人纪录时，左上角会弹出 `+N 纪录名`。纪录保存在浏览器本地（localStorage）。

模式：**60 秒挑战**，或者**无尽解压**（随时从暂停菜单结算）。

## 本地运行

ES 模块不能通过 `file://` 加载，需要起一个静态服务器：

```bash
python3 -m http.server 8000
# 手机和电脑在同一个 Wi-Fi 下时，用 http://<电脑IP>:8000 访问
```

### 部署到 GitHub Pages

仓库里带了部署流程 `.github/workflows/pages.yml`：每次推送到默认分支，都会用 `tools/build_site.sh` 打包游戏运行需要的文件（约 1MB，不含 `assets/source` 里的原始高清素材和工具脚本），然后发布到 GitHub Pages。

第一次需要在仓库里手动开启一次：**Settings → Pages → Build and deployment → Source 选 “GitHub Actions”**。之后到 **Actions** 页重新运行一次 “Deploy to GitHub Pages”（或者再推送一次）。网址是：

```
https://<用户名>.github.io/<仓库名>/
```

注意：私有仓库要开 GitHub Pages，需要 GitHub Pro 或团队版。免费账号得把仓库改成公开才行（网站本身无论如何都是公开的）。

想部署到别的静态托管（Netlify、Cloudflare Pages 等），运行 `tools/build_site.sh`，把生成的 `_site` 目录发布出去即可。iOS Safari 不支持网页全屏 API，可以用"分享 → 添加到主屏幕"，以全屏 App 的方式运行。

## 目录

```
index.html              页面与菜单
style.css               菜单样式
manifest.webmanifest    添加到主屏幕用
src/main.js             游戏主循环、输入、计分、界面
src/foot.js             高跟鞋状态机（抬脚 / 悬停 / 踩下 / 碾压 / 迈步）
src/ants.js             蚂蚁的生成、行为与绘制
src/fx.js               粒子、震屏、地面痕迹、飘字
src/hud.js              计时、击杀、压力条、头像、自尊圈
src/scene.js            程序生成的夜景街道（像素风）
src/audio.js            WebAudio 合成音效（无音频文件）
src/stats.js            纪录与本局统计
assets/source/hd/       原作者提供的高清素材（已抠好透明背景）
assets/sprites/hd/      游戏用的 WebP 精灵与锚点数据（由脚本生成）
tools/extract_hd.py     素材 → 精灵 + 锚点
```

## 素材

高跟鞋和角色头像来自原作者提供的高清素材（`assets/source/hd/`，透明背景由作者手工抠好），已获原作者授权在本项目中使用。如果要公开发布或商用，请再向原作者确认授权范围。

`tools/extract_hd.py` 负责处理素材：
- 裁掉空白，缩到合适大小，转成 WebP（每张约 30 KB）
- 算出每帧的鞋尖、鞋跟尖、红色鞋底中心和靴筒"拉伸行"，写进 `assets/sprites/hd/sprites.json`

游戏里用这些锚点决定踩踏范围、落地对齐，以及把腿向上延伸出屏幕。更换素材后重新运行：

```bash
pip install pillow numpy scipy
python3 tools/extract_hd.py --preview /tmp/preview.jpg
```

如果某帧缺少必需的锚点，游戏会在加载时直接报错，不会进到一半卡死。

头像有两张：平时用绿眼（`12_green_portrait`），满压或一脚踩死很多只时渐变成红眼（`13_red_portrait`）。

背景城市、蚂蚁、界面和音效都是代码生成的，没有使用其他素材。WebP 需要 iOS 14 / Safari 14 及以上。
