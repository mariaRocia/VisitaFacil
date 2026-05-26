# Visita Facil

Sistema web para gestao de visitas comerciais, com frontend Vue, API Node/Express e banco SQLite.

## Executar

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`
- Banco SQLite: `server/data/visitafacil.sqlite`

## Scripts

```bash
npm run dev       # sobe API e frontend
npm run dev:api   # sobe somente a API
npm run dev:web   # sobe somente o Vite
npm run build     # valida TypeScript e gera dist
npm start         # sobe somente a API
```

## Recursos de IA

Os recursos de IA usam a API da OpenAI no backend. Configure a chave antes de iniciar a API:

```powershell
$env:OPENAI_API_KEY="sua-chave"
$env:OPENAI_MODEL="gpt-5-mini"
npm run dev
```

Se `OPENAI_MODEL` nao for informado, a API usa `gpt-5-mini`.

## Banco de dados

A migration SQL fica em `server/migrations/001_schema.sql` e cria:

- `concessionarias`
- `produtos`
- `tipos_visita`
- `visitas`
- `visita_produtos`
- `propostas`
- `proposta_produtos`

A API aplica a migration automaticamente ao iniciar e cria os tipos de visita base.

## Regras implementadas

- Visitas exigem concessionaria, tipo de visita, data e pelo menos um produto.
- Produtos vinculados a visitas nao podem ser excluidos.
- Concessionarias com visitas nao podem ser excluidas.
- Tipos de visita vinculados a visitas sao desativados quando a exclusao e solicitada.
- Tipos inativos nao aparecem no cadastro de nova visita.
- Dashboard e consultas sao calculados diretamente dos dados cadastrados.
- Em qualquer visita, com ou sem proposta, e possivel informar a data e hora da proxima reuniao.
- Produtos possuem valor unitario obrigatorio.
- Visitas marcadas com proposta criam uma proposta automaticamente com status `Em andamento`.
- Propostas armazenam itens com valor original, valor negociado, quantidade e total calculado.
- Propostas possuem status, finalizacao, motivo de perda, observacao final, proxima call e follow-up.
