# LunaBot

Agente pessoal desktop, open source (Apache-2.0), só Windows por enquanto. A IA vem do CLI `claude` já instalado e logado pelo usuário, chamado como subprocesso (Etapa 1).

## Projeto

Monorepo pnpm com workspaces `apps/*` e `packages/*`.

- Node.js 24.22.1 (`engines`: >=24)
- pnpm 12.15.0 (campo `packageManager`)
- TypeScript 6.0.3 (strict, base em `tsconfig.base.json`)
- Lint: ESLint 10.13.0 (flat config em `eslint.config.js`), typescript-eslint 8.72.1
- Formatação: Prettier 3.9.10
- Testes: Vitest 5.0.5
- Desktop (`apps/desktop`): Tauri 2 (crate `tauri` 2.12.5, `@tauri-apps/cli` e `@tauri-apps/api` 2.12.4), React 19.3.1, Vite 8.3.5
- Rust 1.99.1 (edition 2024) para o `src-tauri`
- Pacotes: `packages/shared` (`@lunabot/shared`), `packages/agent` (`@lunabot/agent`)

## Comandos

- Instalar: `pnpm install`
- Testar um arquivo: `pnpm vitest run <caminho do arquivo de teste>`, por exemplo `pnpm vitest run packages/shared/src/message.test.ts`
- Suíte completa: `pnpm test` (somente quando eu pedir)
- CI no GitHub (manual): `gh workflow run ci.yml --ref <branch>`
- Lint e formatação: `pnpm lint` (ESLint + `prettier --check`); para corrigir formatação, `pnpm format`
- Tipos: `pnpm typecheck`
- Sidecar do agente (antes de `tauri dev`): `pnpm --filter @lunabot/agent build`, que gera `packages/agent/dist/sidecar.mjs`
- Testes do agente ou do desktop: `pnpm --filter @lunabot/agent exec vitest run <arquivo>` ou `pnpm --filter desktop test`

## Armadilhas conhecidas

- CI só quando o usuário pedir. O workflow `.github/workflows/ci.yml` roda apenas por `workflow_dispatch`, sem push nem pull_request. Não disparar `gh workflow run` por conta própria.

- Desenvolvimento: o Rust roda `node` do PATH com o script em caminho fixo (`CARGO_MANIFEST_DIR/../../../packages/agent/dist/sidecar.mjs`). Empacotamento para distribuição está fora da Etapa 1.
- O Rust define `LUNABOT_DATA_DIR` com `app_data_dir`. Sem essa variável o sidecar encerra com erro.
- No Windows só `claude.exe` é aceito. `claude.cmd` (instalação via npm) é ignorado, pois não roda sem shell.
- O agente não usa `--bare`, porque ele não lê o login da assinatura. Por isso hooks e servidores MCP do `~/.claude` do usuário continuam carregando. As ferramentas embutidas são desligadas com `--tools ""`.
- `pnpm install` pode falhar com `ERR_PNPM_IGNORED_BUILDS` (esbuild). O binário funciona mesmo assim. Aprovar o script com `pnpm approve-builds` depende de decisão sua.
- No Windows, o Controle de Aplicativo pode bloquear o build script do Rust (erro 4551). Isso é política da máquina, não do projeto.
- Risco de termos: o uso da assinatura do usuário via CLI `claude` por app de terceiros não está confirmado como permitido pela Anthropic (https://code.claude.com/docs/en/legal-and-compliance.md). Não tratar esse fluxo como resolvido.
- Nunca ler, copiar, logar nem guardar credenciais ou tokens, como `~/.claude/.credentials.json`. Isso vale para código, testes, logs e commits.
- Ferramentas do agente vêm liberadas por padrão. Ao integrar e-mail ou outras fontes de texto externo, considerar prompt injection.
- Não usar a marca "Claude Code" e não copiar código do openbot.run.
