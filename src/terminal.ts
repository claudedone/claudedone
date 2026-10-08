import {invoke} from '@tauri-apps/api/core';
import {native} from './bridge';

export type TerminalTool = 'claude' | 'codex' | 'gemini' | 'shell';
export interface TerminalCatalog {
  homeDirectory: string;
  tools: {id: TerminalTool; installed: boolean}[];
}
export const terminalTools: {id: TerminalTool; name: string; brand: string; command: string; description: string; guide?: string}[] = [
  {id:'claude',name:'Claude Code',brand:'Anthropic',command:'claude',description:'在终端里使用 Claude，继续你熟悉的开发流程。',guide:'https://code.claude.com/docs/en/setup'},
  {id:'codex',name:'Codex CLI',brand:'ChatGPT · OpenAI',command:'codex',description:'通过 Codex CLI，在本地项目中使用 OpenAI 的编程助手。',guide:'https://learn.chatgpt.com/docs/codex/cli'},
  {id:'gemini',name:'Gemini CLI',brand:'Google',command:'gemini',description:'从工作目录启动 Gemini，处理代码与日常任务。',guide:'https://geminicli.com/docs/get-started/installation/'},
  {id:'shell',name:'普通终端',brand:'YOUR WORKSPACE',command:'',description:'打开终端，手动运行你喜欢的 CLI 或其他命令。'},
];
export async function getTerminalCatalog(): Promise<TerminalCatalog> {
  if(native) return invoke('list_terminal_tools');
  return {homeDirectory:'',tools:terminalTools.map(t=>({id:t.id,installed:t.id!=='gemini'}))};
}
export async function launchTerminal(tool:TerminalTool,workingDirectory:string):Promise<void> {
  if(native) return invoke('launch_terminal',{tool,workingDirectory});
  throw new Error('当前是界面演示。请在桌面版中打开终端。');
}
export async function openTerminalGuide(tool:TerminalTool):Promise<void> {
  if(native) return invoke('open_terminal_guide',{tool});
  const guide=terminalTools.find(t=>t.id===tool)?.guide;
  if(guide) window.open(guide,'_blank','noopener,noreferrer');
}
