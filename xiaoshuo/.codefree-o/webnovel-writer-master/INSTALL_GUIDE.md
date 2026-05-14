# CodeFree-O 插件安装指南：以 webnovel-writer 为例

> 本文档记录了将自定义插件安装到 CodeFree-O 的完整过程与踩坑经验，供下次快速复用。

---

## 1. 插件目录结构要求

CodeFree-O（基于 OpenCode）识别插件需要以下关键结构：

```
<插件根目录>/
├── package.json                          # 必须有 main 字段指向插件 JS
├── .opencode/
│   └── plugins/
│       └── <插件名>.js                   # 插件入口（main 字段指向此文件）
├── skills/                               # Skill 定义目录
│   ├── <skill-name>/
│   │   └── SKILL.md                      # Skill 描述文件（frontmatter + 正文）
│   └── ...
├── scripts/                              # 辅助脚本（Python 等）
└── references/                           # 参考文档（可选）
```

### 关键文件说明

| 文件 | 作用 | 注意事项 |
|------|------|----------|
| `package.json` | 声明插件元数据 | **`main` 必须指向 `.opencode/plugins/<name>.js`**，不能指向空导出的 `index.js` |
| `.opencode/plugins/<name>.js` | 插件入口，导出插件函数 | 必须通过 `config` hook 注册 skills 路径 |
| `skills/<name>/SKILL.md` | Skill 定义 | 支持 YAML frontmatter（name, description） |

---

## 2. 两个必改项（根因）

### 2.1 `package.json` 的 `main` 字段

```json
{
  "name": "webnovel-writer",
  "version": "6.0.0",
  "type": "module",
  "main": ".opencode/plugins/webnovel-writer.js"
}
```

**错误写法**：`"main": "index.js"` — 指向空导出 `export default {}`，CodeFree-O 无法发现 skills。

**正确写法**：`"main": ".opencode/plugins/webnovel-writer.js"` — 指向真正的插件入口。

### 2.2 插件 JS 中的 skills 路径

```javascript
// 文件位置：.opencode/plugins/webnovel-writer.js
// __dirname = <插件根>/.opencode/plugins/

// 错误：path.resolve(__dirname, '../skills')
//   → 解析到 <插件根>/.opencode/skills/（不存在！）

// 正确：path.resolve(__dirname, '../../skills')
//   → 解析到 <插件根>/skills/（实际位置）
const skillsDir = path.resolve(__dirname, '../../skills');
```

**路径推导**：
- `__dirname` = `<插件根>/.opencode/plugins/`
- `../` = `<插件根>/.opencode/`
- `../../` = `<插件根>/`
- `../../skills` = `<插件根>/skills/` ✅

---

## 3. 插件 JS 完整模板

参照成功安装的 superpowers 插件模式，插件需要：

1. **`config` hook**：注册 skills 目录路径
2. **`experimental.chat.messages.transform` hook**：注入 bootstrap 上下文到对话

```javascript
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== Frontmatter 解析器 =====
const extractAndStripFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content };
  const frontmatterStr = match[1];
  const body = match[2];
  const frontmatter = {};
  for (const line of frontmatterStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      frontmatter[key] = value;
    }
  }
  return { frontmatter, content: body };
};

let _bootstrapCache = undefined;

export const WebnovelWriterPlugin = async ({ client, directory }) => {
  // ★ 关键：路径必须正确
  const skillsDir = path.resolve(__dirname, '../../skills');

  const getBootstrapContent = () => {
    if (_bootstrapCache !== undefined) return _bootstrapCache;

    // 自动发现 skills
    const skillFiles = [
      { name: 'webnovel-init', path: path.join(skillsDir, 'webnovel-init', 'SKILL.md') },
      // ... 添加所有 skill
    ];

    const availableSkills = [];
    for (const sf of skillFiles) {
      if (fs.existsSync(sf.path)) {
        const raw = fs.readFileSync(sf.path, 'utf8');
        const { frontmatter } = extractAndStripFrontmatter(raw);
        availableSkills.push({
          name: frontmatter.name || sf.name,
          description: frontmatter.description || '',
        });
      }
    }

    if (availableSkills.length === 0) {
      _bootstrapCache = null;
      return null;
    }

    const skillList = availableSkills
      .map(s => `  - **${s.name}**: ${s.description}`)
      .join('\n');

    _bootstrapCache = `<EXTREMELY_IMPORTANT>
You have the webnovel-writer plugin installed.

**Available skills (use the \`skill\` tool to load them):**
${skillList}

**Tool Mapping for OpenCode:**
- \`TodoWrite\` → \`todowrite\`
- \`Task\` tool with subagents → Use OpenCode's subagent system
- \`Skill\` tool → OpenCode's native \`skill\` tool
- \`Read\`, \`Write\`, \`Edit\`, \`Bash\` → Your native tools
- \`AskUserQuestion\` → \`question\` tool
- \`Agent\` → Use OpenCode's subagent system
</EXTREMELY_IMPORTANT>`;

    return _bootstrapCache;
  };

  return {
    // Hook 1: 注册 skills 路径
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },

    // Hook 2: 注入 bootstrap 上下文
    'experimental.chat.messages.transform': async (_input, output) => {
      const bootstrap = getBootstrapContent();
      if (!bootstrap || !output.messages.length) return;
      const firstUser = output.messages.find(m => m.info.role === 'user');
      if (!firstUser || !firstUser.parts.length) return;
      if (firstUser.parts.some(p => p.type === 'text' && p.text.includes('EXTREMELY_IMPORTANT'))) return;
      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap });
    }
  };
};
```

---

## 4. 配置文件

### 4.1 项目级配置（推荐）

文件：`<项目根>/.codefree-o/codefree.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./webnovel-writer-master"
  ]
}
```

路径相对于 `.codefree-o/` 目录解析。

### 4.2 全局配置

文件：`C:\Users\<用户名>\.codefree-o\.config\codefree.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "E:\\01gx\\CFO\\xiaoshuo\\.codefree-o\\webnovel-writer-master"
  ]
}
```

全局配置需要绝对路径。

### 优先级

项目级 > 全局级。两者都配了不会冲突，但建议只在项目级配置。

---

## 5. 验证步骤

### 5.1 检查插件是否被识别

```bash
codefree-o debug config
```

输出中应包含 `plugin_origins` 数组，且 `spec` 指向正确路径。

### 5.2 检查 skills 是否被发现

```bash
codefree-o debug skill
```

应返回 skills 数组，每个 skill 包含 `name`、`description`、`location`、`content`。

### 5.3 常见问题排查

| 症状 | 原因 | 修复 |
|------|------|------|
| `debug skill` 返回空 `[]` | `package.json` 的 `main` 指向空文件 | 改为 `.opencode/plugins/<name>.js` |
| `debug skill` 返回空 `[]` | 插件 JS 中 skills 路径错误 | 修正 `path.resolve(__dirname, '../../skills')` |
| `debug config` 无 `plugin_origins` | 配置文件路径错误或格式错误 | 检查 `.codefree-o/codefree.json` |
| 插件加载但 skill 不生效 | SKILL.md 缺少 frontmatter | 添加 `---\nname: xxx\ndescription: xxx\n---\n` |
| 运行中会话无法使用新 skill | 会话启动时加载插件 | 重启 CodeFree-O 终端会话 |

---

## 6. Python 依赖（webnovel-writer 特有）

webnovel-writer 的脚本依赖以下 Python 包：

```bash
pip install aiohttp filelock fastapi watchdog
```

验证脚本可用：

```bash
python -X utf8 "<插件路径>/scripts/webnovel.py" --help
python -X utf8 "<插件路径>/scripts/webnovel.py" --project-root "<项目路径>" preflight
```

---

## 7. 快速安装 Checklist

安装新插件时，按此清单逐项检查：

- [ ] 插件目录放在 `<项目根>/.codefree-o/<插件名>/` 下
- [ ] `package.json` 存在且 `main` 指向 `.opencode/plugins/<name>.js`
- [ ] `.opencode/plugins/<name>.js` 存在且导出插件函数
- [ ] 插件 JS 中 `skillsDir` 路径正确（`../../skills` 相对于 `.opencode/plugins/`）
- [ ] `skills/` 目录存在，每个子目录含 `SKILL.md`
- [ ] `.codefree-o/codefree.json` 中 `plugin` 数组包含插件路径
- [ ] 运行 `codefree-o debug config` 确认插件被识别
- [ ] 运行 `codefree-o debug skill` 确认 skills 被发现
- [ ] 安装 Python 依赖（如需要）
- [ ] 重启 CodeFree-O 会话使变更生效

---

## 8. 参考插件：superpowers

成功安装的参考插件，位于 CodeFree-O 缓存目录：

```
C:\Users\Administrator\.codefree-o\.cache\packages\git+https_\github.com\obra\superpowers.git\
```

其结构：
```
superpowers/
├── package.json                    # main: ".opencode/plugins/superpowers.js"
├── .opencode/
│   └── plugins/
│       └── superpowers.js          # 导出 SuperpowersPlugin
├── skills/                         # Skill 定义
│   └── ...
└── ...
```

遇到问题时，对比 superpowers 的结构排查差异。

---

## 9. 环境信息

| 项目 | 值 |
|------|-----|
| 平台 | Windows (win32) |
| Python | 3.10.9 |
| CodeFree-O 配置目录 | `C:\Users\Administrator\.codefree-o\` |
| 项目根 | `E:\01gx\CFO\xiaoshuo\` |
| 插件位置 | `E:\01gx\CFO\xiaoshuo\.codefree-o\webnovel-writer-master\` |
| 项目配置 | `E:\01gx\CFO\xiaoshuo\.codefree-o\codefree.json` |
| 全局配置 | `C:\Users\Administrator\.codefree-o\.config\codefree.json` |

---

## 10. GitHub 改好再装 vs 下载后本地改

### 核心结论

**跟安装方式没关系，跟插件源码有没有适配 CodeFree-O 有关系。**

不管 GitHub 改好再装，还是下载后本地改，效果一样。关键是：原始插件是为 Claude Code 写的，不是为 CodeFree-O（OpenCode）写的，所以有两个结构性缺陷必须修：

| 问题 | 原因 | 谁的锅 |
|------|------|--------|
| `package.json` 的 `main` 指向空 `index.js` | 插件作者没写 OpenCode 入口 | 源码问题 |
| skills 路径 `../skills` 解析错误 | `.opencode/plugins/` 多了一层目录 | 源码问题 |

### 两种策略对比

| | GitHub 改好再装 | 下载后本地改 |
|--|--|--|
| **优点** | 一劳永逸，别人也能用；`git pull` 更新不丢改动 | 快速验证；不用等 PR 合并 |
| **缺点** | 需要 fork + PR 权限；原作者不合并就白改 | 每次更新覆盖你的修改 |
| **适合** | 你是插件作者/贡献者 | 你只是使用者，想快速跑起来 |

### 建议

1. **如果你是插件作者**：直接在 GitHub 源码修好，加一个 `.opencode/plugins/<name>.js` 入口，改 `package.json` 的 `main`。这样所有人装完就能用。

2. **如果你只是使用者**：下载后本地改（就像我们这次做的），但注意：
   - 不要 `git pull` 更新覆盖修改
   - 或者写个 patch 脚本，更新后自动重新应用修改

3. **最理想**：给原作者提个 Issue/PR，让他原生支持 OpenCode 格式（加 `.opencode/` 目录和入口文件），这样以后 `codefree-o plugin install` 就能直接用。

**一句话：问题不在安装方式，在于源码没适配 CodeFree-O 的插件规范。**

---

## 11. 本次安装完整过程回顾

### 背景

将 `webnovel-writer` 插件（GitHub: lingfengQAQ/webnovel-writer）安装到 CodeFree-O 中，使 7 个 skills 能被识别和加载。

### 根因分析

webnovel-writer 插件无法加载的两个关键问题：

1. **`package.json` 的 `main` 字段指向 `"index.js"`**（空导出 `export default {}`），而不是 `.opencode/plugins/webnovel-writer.js`（真正的插件入口）
2. **插件 JS 文件中 skills 路径解析错误**：`path.resolve(__dirname, '../skills')` 解析到 `.opencode/skills/`（不存在），实际 skills 在插件根目录的 `skills/` 下，应为 `../../skills`

### 参考对象

成功安装的 superpowers 插件（GitHub: obra/superpowers）：
- `package.json` → `"main": ".opencode/plugins/superpowers.js"` ✅
- `.opencode/plugins/superpowers.js` → 导出 `SuperpowersPlugin`，通过 `config` hook 注入 skills 路径，通过 `experimental.chat.messages.transform` hook 注入 bootstrap 上下文
- 缓存位置：`C:\Users\Administrator\.codefree-o\.cache\packages\git+https_\github.com\obra\superpowers.git\`

### 修复操作

| 步骤 | 操作 | 状态 |
|------|------|------|
| 1 | 修复 `package.json`：`main` 从 `"index.js"` 改为 `".opencode/plugins/webnovel-writer.js"` | ✅ |
| 2 | 重写 `.opencode/plugins/webnovel-writer.js`：修正 skills 路径为 `../../skills`，添加 `config` hook 和 `experimental.chat.messages.transform` hook | ✅ |
| 3 | 安装 Python 依赖：`pip install aiohttp filelock fastapi watchdog` | ✅ |
| 4 | 验证：`codefree-o debug skill` 显示 7 个 skills | ✅ |
| 5 | 重启 CodeFree-O 会话使变更生效 | ⚠️ 需用户操作 |

### 验证结果

`codefree-o debug skill` 输出 7 个 skills：

1. `webnovel-init` — 深度初始化网文项目
2. `webnovel-plan` — 生成卷纲、时间线和章纲
3. `webnovel-write` — 产出可发布章节
4. `webnovel-review` — 章节质量审查
5. `webnovel-query` — 查询项目设定、角色、力量体系等
6. `webnovel-learn` — 提取成功模式写入 project_memory.json
7. `webnovel-dashboard` — 启动只读小说管理面板

### 关键文件清单

| 文件 | 说明 |
|------|------|
| `E:\01gx\CFO\xiaoshuo\.codefree-o\webnovel-writer-master\package.json` | 已修改：main 字段 |
| `E:\01gx\CFO\xiaoshuo\.codefree-o\webnovel-writer-master\.opencode\plugins\webnovel-writer.js` | 已重写：修正路径、添加 hooks |
| `E:\01gx\CFO\xiaoshuo\.codefree-o\webnovel-writer-master\index.js` | 原空入口文件（不再被引用） |
| `E:\01gx\CFO\xiaoshuo\.codefree-o\webnovel-writer-master\skills\` | 7 个 skill 目录 |
| `E:\01gx\CFO\xiaoshuo\.codefree-o\webnovel-writer-master\scripts\` | Python 脚本目录 |
| `E:\01gx\CFO\xiaoshuo\.codefree-o\codefree.json` | 项目级配置 |
| `C:\Users\Administrator\.codefree-o\.config\codefree.json` | 全局配置 |
