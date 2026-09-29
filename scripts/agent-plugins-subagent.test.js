/**
 * The inject hook's subagent mode: on SubagentStart a spawned agent (which may
 * have no Skill tool) is handed each omega skill as a SKILL.md path to Read,
 * plus the command that records the read for the edit gate.
 * Run: node --test scripts/agent-plugins-subagent.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('subagent: hooks.json wires the subagent mode on SubagentStart for every agent', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const entries = hooks.SubagentStart || [];
  assert.ok(entries.every((entry) => entry.matcher === undefined), 'a matcher would skip some agents');
  const commands = entries.flatMap((entry) => entry.hooks.map((hook) => hook.command));
  assert.ok(commands.some((command) => /hooks\/inject\/run\.sh subagent$/.test(command)), 'no SubagentStart inject in subagent mode');
});

test('subagent: a brand root hands every skill as a SKILL.md path, then the map and the mark command', () => {
  const dir = doneWhenBrand();
  const out = JSON.parse(spawnAgent(dir, { session: agentSession(), agent: 'agent-1' }));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SubagentStart');

  const ctx = out.hookSpecificOutput.additionalContext;
  const lines = ctx.split('\n');
  assert.equal(lines[0], 'OMEGA project detected. Read these skills with the Read tool before working (a subagent may have no Skill tool):');
  for (const name of ['main', 'manager', 'web', 'backend']) {
    const skillPath = path.join(PLUGIN_ROOT, 'skills', name, 'SKILL.md');
    assert.ok(lines.includes(`- omega:${name}: ${skillPath}`), `no path line for omega:${name}`);
    assert.ok(fs.existsSync(skillPath), `${skillPath} does not exist`);
  }
  assert.doesNotMatch(ctx, /via the Skill tool/);
  assert.match(lines.at(-2), /node_modules\/@omega\.js\/AGENTS\.md/, 'the brand line names the framework map');
  assert.match(lines.at(-1), /hooks\/gate\/mark\.sh" <skill> --session /, 'the last line names the gate mark command');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('subagent: the mark command it is handed unlocks the gate for that skill', () => {
  const dir = doneWhenBrand();
  const session = agentSession();
  const ctx = JSON.parse(spawnAgent(dir, { session, agent: 'agent-1' })).hookSpecificOutput.additionalContext;
  const [, script, marked] = ctx.split('\n').at(-1).match(/"([^"]+)" <skill> --session (\S+)$/);
  const file = path.join(dir, 'targets', 'web', 'src', 'index.html');

  assert.equal(gate(file, session).status, 2, 'the edit is refused before the mark');
  execFileSync(script, ['omega:web', '--session', marked], { encoding: 'utf8' });
  assert.equal(gate(file, session).status, 0, 'the handed command did not unlock the gate');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('subagent: each agent gets its copy once, and the main chat keeps its own', () => {
  const dir = doneWhenBrand();
  const session = agentSession();
  assert.match(spawnAgent(dir, { session, agent: 'agent-1' }), /omega:web/);
  assert.equal(spawnAgent(dir, { session, agent: 'agent-1' }), '', 'the same agent was injected twice');
  assert.match(spawnAgent(dir, { session, agent: 'agent-2' }), /omega:web/, 'a second agent got no copy');
  assert.match(inject(dir, session), /invoke these skills via the Skill tool/, 'the spawns used up the main chat injection');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('subagent: outside an omega project it gets nothing', () => {
  for (const manifest of [{ name: 'plain', dependencies: { express: '^4.0.0' } }, null]) {
    const dir = project(manifest);
    assert.equal(spawnAgent(dir, { session: agentSession(), agent: 'agent-1' }), '');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
