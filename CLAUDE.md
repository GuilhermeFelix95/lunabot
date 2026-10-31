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
- Lint e formatação: `pnpm lint` (ESLint + `prettier --check`); para corrigir formatação, `pnpm format`
- Tipos: `pnpm typecheck`

## Armadilhas conhecidas

- Risco de termos: o uso da assinatura do usuário via CLI `claude` por app de terceiros não está confirmado como permitido pela Anthropic (https://code.claude.com/docs/en/legal-and-compliance.md). Não tratar esse fluxo como resolvido.
- Nunca ler, copiar, logar nem guardar credenciais ou tokens, como `~/.claude/.credentials.json`. Isso vale para código, testes, logs e commits.
- Ferramentas do agente vêm liberadas por padrão. Ao integrar e-mail ou outras fontes de texto externo, considerar prompt injection.
- Não usar a marca "Claude Code" e não copiar código do openbot.run.
