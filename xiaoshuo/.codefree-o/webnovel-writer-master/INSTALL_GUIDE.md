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
