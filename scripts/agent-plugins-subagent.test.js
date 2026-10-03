/**
 * The inject hook's subagent mode: on SubagentStart a spawned agent (which may
 * have no Skill tool) is handed each omega skill as a SKILL.md path to Read,
 * plus the command that records the read for the edit gate.
 * Run: node --test scripts/agent-plugins-subagent.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { PLUGIN_ROOT, INJECT_HOOK, project, inject, doneWhenBrand, gate } = require('./agent-plugins-fixtures');

// A spawn carries no prompt, only the subagent's own id and type beside the
// session; the plugin root comes from the environment Claude Code sets.
const spawnAgent = (dir, { session, agent }) => execFileSync(INJECT_HOOK, ['subagent'], {
  input: JSON.stringify({
    hook_event_name: 'SubagentStart',
    session_id: session,
    agent_id: agent,
    agent_type: 'workkit:worker',
    cwd: dir,
  }),
  env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  encoding: 'utf8',
});

// The hook's markers outlive the test process, so every case takes a fresh session.
let sessions = 0;
const agentSession = () => `agent-${process.pid}-${Date.now()}-${++sessions}`;

module.exports = defineCases({
  type: 'group',
  description: 'agent-plugins-subagent',
  tests: [
    {
      name: 'subagent: hooks.json wires the subagent mode on SubagentStart for every agent',
      run: (ctx) => {
        const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
        const entries = hooks.SubagentStart || [];
        ctx.expect(entries.every((entry) => entry.matcher === undefined), 'a matcher would skip some agents').toBeTruthy();
        const commands = entries.flatMap((entry) => entry.hooks.map((hook) => hook.command));
        ctx.expect(commands.some((command) => /hooks\/inject\/run\.sh subagent$/.test(command)), 'no SubagentStart inject in subagent mode').toBeTruthy();
      },
    },

    {
      name: 'subagent: a brand root hands every skill as a SKILL.md path, then the map and the mark command',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const out = JSON.parse(spawnAgent(dir, { session: agentSession(), agent: 'agent-1' }));
        ctx.expect(out.hookSpecificOutput.hookEventName).toBe('SubagentStart');

        const context = out.hookSpecificOutput.additionalContext;
        const lines = context.split('\n');
        ctx.expect(lines[0]).toBe('OMEGA project detected. Read these skills with the Read tool before working (a subagent may have no Skill tool):');
        for (const name of ['main', 'manager', 'web', 'backend']) {
          const skillPath = path.join(PLUGIN_ROOT, 'skills', name, 'SKILL.md');
          ctx.expect(lines.includes(`- omega:${name}: ${skillPath}`), `no path line for omega:${name}`).toBeTruthy();
          ctx.expect(fs.existsSync(skillPath), `${skillPath} does not exist`).toBeTruthy();
        }
        ctx.expect(context).not.toMatch(/via the Skill tool/);
        ctx.expect(lines.at(-2), 'the brand line names the framework map').toMatch(/node_modules\/@omega\.js\/manager\/AGENTS\.md/);
        ctx.expect(lines.at(-1), 'the last line names the gate mark command').toMatch(/hooks\/gate\/mark\.sh" <skill> --session /);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'subagent: the mark command it is handed unlocks the gate for that skill',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = agentSession();
        const context = JSON.parse(spawnAgent(dir, { session, agent: 'agent-1' })).hookSpecificOutput.additionalContext;
        const [, script, marked] = context.split('\n').at(-1).match(/"([^"]+)" <skill> --session (\S+)$/);
        const file = path.join(dir, 'targets', 'web', 'src', 'index.html');

        ctx.expect(gate(file, session).status, 'the edit is refused before the mark').toBe(2);
        execFileSync(script, ['omega:web', '--session', marked], { encoding: 'utf8' });
        ctx.expect(gate(file, session).status, 'the handed command did not unlock the gate').toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'subagent: each agent gets its copy once, and the main chat keeps its own',
      run: (ctx) => {
        const dir = doneWhenBrand();
        const session = agentSession();
        ctx.expect(spawnAgent(dir, { session, agent: 'agent-1' })).toMatch(/omega:web/);
        ctx.expect(spawnAgent(dir, { session, agent: 'agent-1' }), 'the same agent was injected twice').toBe('');
        ctx.expect(spawnAgent(dir, { session, agent: 'agent-2' }), 'a second agent got no copy').toMatch(/omega:web/);
        ctx.expect(inject(dir, session), 'the spawns used up the main chat injection').toMatch(/invoke these skills via the Skill tool/);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'subagent: outside an omega project it gets nothing',
      run: (ctx) => {
        for (const manifest of [{ name: 'plain', dependencies: { express: '^4.0.0' } }, null]) {
          const dir = project(manifest);
          ctx.expect(spawnAgent(dir, { session: agentSession(), agent: 'agent-1' })).toBe('');
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ],
});
