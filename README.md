# Visita Facil

Sistema web para gestao de visitas comerciais, com frontend Vue, API Node/Express e banco MySQL.

## Executar

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`
- Banco MySQL: `visitafacil`

## Scripts

```bash
npm run dev       # sobe API e frontend
npm run dev:api   # sobe somente a API
npm run dev:web   # sobe somente o Vite
npm run build     # valida TypeScript e gera dist
npm start         # sobe somente a API
```

## Recursos de IA

Os recursos de IA estao desativados no backend e removidos da interface.

## Banco de dados

A API usa MySQL via `mysql2`. Por padrao ela conecta em:

```bash
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=visitafacil
```

Se seu MySQL tiver senha ou outro usuario, crie um arquivo `.env` na raiz do projeto usando `.env.example` como modelo.

Para enviar e-mails de recuperacao de senha, configure tambem:

```bash
APP_URL=http://localhost:5173
SMTP_HOST=smtp.seudominio.com
SMTP_PORT=587
SMTP_USER=usuario@seudominio.com
SMTP_PASSWORD=sua-senha
SMTP_FROM=usuario@seudominio.com
```

Sem SMTP configurado, a recuperacao gera o link no log da API para facilitar testes locais. Usuarios antigos precisam ter o campo `email` preenchido na tabela `usuarios` para receber a recuperacao.

A migration MySQL fica em `server/migrations/001_schema.mysql.sql` e cria:

- `concessionarias`
- `produtos`
- `tipos_visita`
- `usuarios`
- `sessoes`
- `recuperacoes_senha`
- `visitas`
- `visita_produtos`
- `propostas`
- `proposta_produtos`

A API aplica a migration automaticamente ao iniciar.

## Regras implementadas

- Visitas exigem concessionaria, tipo de visita, data e pelo menos um produto.
- Produtos vinculados a visitas nao podem ser excluidos.
- Concessionarias com visitas nao podem ser excluidas.
- Tipos de visita vinculados a visitas sao desativados quando a exclusao e solicitada.
- Tipos inativos nao aparecem no cadastro de nova visita.
- Dashboard e consultas sao calculados diretamente dos dados cadastrados.
- Cada usuario ve apenas seus proprios registros: concessionarias, produtos, tipos de visita, visitas, propostas e resultados do dashboard.
- Em qualquer visita, com ou sem proposta, e possivel informar a data e hora da proxima reuniao.
- Produtos possuem valor unitario obrigatorio.
- Visitas marcadas com proposta criam uma proposta automaticamente com status `Em andamento`.
- Propostas armazenam itens com valor original, valor negociado, quantidade e total calculado.
- Propostas possuem status, finalizacao, motivo de perda, observacao final, proxima call e follow-up.
