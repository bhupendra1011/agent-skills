# Agent Skills

A collection of AI agent skills for Claude Code, Cursor, Windsurf, and other coding agents.

## Skills

| Skill | Description | Version |
|-------|-------------|---------|
| [convo-agent-skills](./convo-agent-skills/) | Build real-time conversational AI apps with Agora RTC/RTM, Next.js, voice/video agents, transcripts, chat, avatars, and settings UI | v1.1.0 |

## Installation

Install a specific skill:

```bash
npx skills add https://github.com/bhupendra1011/agent-skills/tree/main/convo-agent-skills
```

Or install globally:

```bash
npx skills add https://github.com/bhupendra1011/agent-skills/tree/main/convo-agent-skills -g -y
```

## What are Agent Skills?

Agent skills are reusable instruction sets that extend AI coding agents. Each skill contains:
- **SKILL.md** — activation rules and instructions
- **references/** — detailed guides the agent follows
- **snippets/** — code templates the agent uses as starting points

When you ask an AI agent to build something, it automatically activates relevant skills and follows the instructions to generate production-quality code.

## Adding More Skills

Create a new folder with a `SKILL.md`:

```
your-skill-name/
├── SKILL.md          # Required: YAML frontmatter + instructions
├── references/       # Optional: detailed guides
└── snippets/         # Optional: code templates
```

## License

MIT
