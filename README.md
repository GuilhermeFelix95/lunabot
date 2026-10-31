# LunaBot

Agente pessoal de código aberto (Apache-2.0) para Windows. Roda no seu computador e usa o CLI `claude` que você já instalou e autenticou como motor de IA.

## O que é

- App desktop com Tauri 2 + React + TypeScript.
- Um sidecar Node/TypeScript (`packages/agent`) executa o agente.
- Sem custo para o mantenedor: a IA é a assinatura/conta que o próprio usuário já tem no CLI do Claude.

## Status

Etapa 0 (fundação): estrutura do monorepo, licença, CI e ferramentas de qualidade. Ainda não há funcionalidade de agente.

## Riscos conhecidos

**(a) Uso da assinatura via CLI por app de terceiros.** Não está confirmado que os termos da Anthropic permitem o uso da assinatura do usuário via CLI do Claude por um aplicativo de terceiros. Consulte https://code.claude.com/docs/en/legal-and-compliance.md. O LunaBot nunca lê, copia nem guarda credenciais ou tokens (como `~/.claude/.credentials.json`). Cada usuário é responsável por cumprir os termos do seu provedor.

**(b) Ações de ferramentas liberadas por padrão.** As ferramentas do agente vêm liberadas por padrão. Quando houver integração de e-mail, há risco de _prompt injection_: conteúdo malicioso em uma mensagem pode induzir o agente a executar ações indesejadas.

## Marca e origem

O projeto não usa a marca "Claude Code" e não deriva de código do openbot.run.

## Licença

Apache-2.0. Veja `LICENSE` e `NOTICE`.
