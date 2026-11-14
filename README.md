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

部署到任意静态托管（GitHub Pages、Netlify、Vercel 等）都可以，把仓库根目录发布出去即可。iOS Safari 不支持网页全屏 API，可以用"分享 → 添加到主屏幕"，以全屏 App 的方式运行。

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
assets/source/sheet.jpg 原始素材图
assets/sprites/         从素材图切出的透明 PNG 与锚点数据
tools/extract_sprites.py 切图脚本
```

## 素材

高跟鞋与角色头像来自原作者提供的素材图（`assets/source/sheet.jpg`），已获原作者授权在本项目中使用。如果要公开发布或商用，请再向原作者确认授权范围。

素材图是黑底 JPEG，鞋身本身也是纯黑，没法直接抠掉背景。`tools/extract_sprites.py` 用"高光轮廓 + 正交凸包 + 形态学闭运算"重建每帧的剪影作为透明通道，同时算出鞋尖、鞋跟、鞋底中心等锚点，写进 `assets/sprites/sprites.json`。更换素材后重新运行：

```bash
pip install pillow numpy scipy
python3 tools/extract_sprites.py
```

背景城市、蚂蚁、界面和音效都是代码生成的，没有使用其他素材。
