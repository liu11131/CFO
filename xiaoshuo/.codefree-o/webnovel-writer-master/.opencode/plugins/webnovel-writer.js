/**
 * webnovel-writer plugin for OpenCode.ai
 * 
 * Auto-registers skills directory for long-form web novel creation system.
 * Injects bootstrap context via system prompt transform (following superpowers pattern).
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  const skillsDir = path.resolve(__dirname, '../../skills');

  const getBootstrapContent = () => {
    if (_bootstrapCache !== undefined) return _bootstrapCache;

    const skillFiles = [
      { name: 'webnovel-init', path: path.join(skillsDir, 'webnovel-init', 'SKILL.md') },
      { name: 'webnovel-plan', path: path.join(skillsDir, 'webnovel-plan', 'SKILL.md') },
      { name: 'webnovel-write', path: path.join(skillsDir, 'webnovel-write', 'SKILL.md') },
      { name: 'webnovel-review', path: path.join(skillsDir, 'webnovel-review', 'SKILL.md') },
      { name: 'webnovel-query', path: path.join(skillsDir, 'webnovel-query', 'SKILL.md') },
      { name: 'webnovel-learn', path: path.join(skillsDir, 'webnovel-learn', 'SKILL.md') },
      { name: 'webnovel-dashboard', path: path.join(skillsDir, 'webnovel-dashboard', 'SKILL.md') },
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
You have the webnovel-writer plugin installed — a long-form web novel creation system.

**Available skills (use the \`skill\` tool to load them):**
${skillList}

**Key commands:**
- \`/webnovel-init\` — Deep-initialize a new web novel project
- \`/webnovel-plan\` — Generate volume outlines, timelines, and chapter outlines
- \`/webnovel-write\` — Produce publishable chapters with full review pipeline
- \`/webnovel-review\` — Quality review for existing chapters
- \`/webnovel-query\` — Query project settings, characters, power systems, foreshadowing
- \`/webnovel-learn\` — Extract successful writing patterns into project memory
- \`/webnovel-dashboard\` — Launch read-only management dashboard

**Tool Mapping for OpenCode:**
When skills reference tools you don't have, substitute OpenCode equivalents:
- \`TodoWrite\` → \`todowrite\`
- \`Task\` tool with subagents → Use OpenCode's subagent system (@mention)
- \`Skill\` tool → OpenCode's native \`skill\` tool
- \`Read\`, \`Write\`, \`Edit\`, \`Bash\` → Your native tools
- \`AskUserQuestion\` → \`question\` tool
- \`WebSearch\`, \`WebFetch\` → Your native web tools
- \`Agent\` → Use OpenCode's subagent system

Use OpenCode's native \`skill\` tool to list and load skills.
</EXTREMELY_IMPORTANT>`;

    return _bootstrapCache;
  };

  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },

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
