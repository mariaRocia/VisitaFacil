import cors from 'cors'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AsyncLocalStorage } from 'node:async_hooks'
import express from 'express'
import mysql from 'mysql2/promise'
import nodemailer from 'nodemailer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

loadEnvFile(path.join(rootDir, '.env'))

const migrationPath = path.join(__dirname, 'migrations', '001_schema.mysql.sql')
const port = Number(process.env.API_PORT || 3001)
const dbName = process.env.DB_NAME || 'visitafacil'
const appUrl = process.env.APP_URL || 'http://localhost:5173'
const proposalStatuses = ['Em andamento', 'Em aberto', 'Ganha', 'Perdida']

let pool
const txStorage = new AsyncLocalStorage()

await initDb()

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: 'mysql', name: dbName })
})

app.post('/api/auth/cadastro', h(async (req, res) => {
  const nome = clean(req.body?.nome)
  const login = normalizeLogin(req.body?.login)
  const email = normalizeLogin(req.body?.email)
  const senha = clean(req.body?.senha)
  requireField(nome, 'Nome e obrigatorio')
  requireField(login, 'Login e obrigatorio')
  requireField(email, 'E-mail e obrigatorio')
  if (!isEmail(email)) throw badRequest('E-mail invalido')
  if (senha.length < 4) throw badRequest('Senha deve ter ao menos 4 caracteres')
  if (await findUserByLogin(login)) throw badRequest('Login ja cadastrado')
  if (await findUserByEmail(email)) throw badRequest('E-mail ja cadastrado')

  const result = await run('INSERT INTO usuarios (nome, login, email, senha_hash) VALUES (?, ?, ?, ?)', [nome, login, email, hashPassword(senha)])
  const user = await findById('usuarios', result.insertId)
  res.status(201).json(await createSession(user))
}))

app.post('/api/auth/login', h(async (req, res) => {
  const login = normalizeLogin(req.body?.login)
  const senha = clean(req.body?.senha)
  const user = await findUserByLogin(login)
  if (!user || !verifyPassword(senha, user.senha_hash)) throw unauthorized('Login ou senha invalidos')
  res.json(await createSession(user))
}))

app.post('/api/auth/recuperar-senha', h(async (req, res) => {
  const login = normalizeLogin(req.body?.login)
  requireField(login, 'Informe seu login ou e-mail')
  const user = await findUserByLoginOrEmail(login)

  if (user?.email) {
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = hashResetToken(token)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
    await run('DELETE FROM recuperacoes_senha WHERE usuario_id = ? AND used_at IS NULL', [user.id])
    await run(
      `INSERT INTO recuperacoes_senha (usuario_id, token_hash, expires_at)
      VALUES (?, ?, ?)`,
      [user.id, tokenHash, expiresAt],
    )
    const resetUrl = `${appUrl}/?reset_token=${token}`
    try {
      await sendPasswordResetEmail(user, resetUrl)
    } catch (error) {
      console.error('❌ ERRO SMTP - Falha ao enviar e-mail de recuperacao de senha:')
      console.error('   Código:', error.code)
      console.error('   Mensagem:', error.message)
      console.error('   Comando:', error.command)
      console.error('   Response Code:', error.responseCode)
      console.error('   Stack:', error.stack)
      console.warn(`⚠️  Link de recuperacao para ${user.email}: ${resetUrl}`)
      throw badRequest(mailErrorMessage(error))
    }
  }

  res.json({ message: 'Se o cadastro existir e tiver e-mail, enviaremos as instrucoes de recuperacao.' })
}))

app.post('/api/auth/redefinir-senha', h(async (req, res) => {
  const token = clean(req.body?.token)
  const senha = clean(req.body?.senha)
  requireField(token, 'Token invalido')
  if (senha.length < 4) throw badRequest('Senha deve ter ao menos 4 caracteres')

  const reset = await get(
    `SELECT * FROM recuperacoes_senha
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
    LIMIT 1`,
    [hashResetToken(token)],
  )
  if (!reset) throw badRequest('Link de recuperacao invalido ou expirado')

  await transaction(async () => {
    await run('UPDATE usuarios SET senha_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hashPassword(senha), reset.usuario_id])
    await run('UPDATE recuperacoes_senha SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [reset.id])
    await run('DELETE FROM sessoes WHERE usuario_id = ?', [reset.usuario_id])
  })

  res.json({ message: 'Senha atualizada com sucesso. Faca login novamente.' })
}))

app.post('/api/auth/logout', requireAuth, h(async (req, res) => {
  await run('DELETE FROM sessoes WHERE token = ?', [req.token])
  res.status(204).end()
}))

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user))
})

app.use('/api', requireAuth)

app.get('/api/dashboard', h(async (req, res) => {
  const dateFilters = dashboardDateFilters(req.query, req.user.id)
  const visitWhere = dateFilters.where.length ? ` WHERE ${dateFilters.where.join(' AND ')}` : ''
  const proposalWhere = dateFilters.where.length ? ` AND ${dateFilters.where.join(' AND ')}` : ''
  const proposalBase = `FROM propostas pr JOIN visitas v ON v.id = pr.visita_id WHERE 1 = 1${proposalWhere}`
  const concessionarias = await scalar('SELECT COUNT(*) FROM concessionarias WHERE usuario_id = ?', [req.user.id])
  const produtos = await scalar('SELECT COUNT(*) FROM produtos WHERE usuario_id = ?', [req.user.id])
  const visitas = await scalar(`SELECT COUNT(*) FROM visitas v${visitWhere}`, dateFilters.params)
  const propostas = await scalar(`SELECT COUNT(*) ${proposalBase}`, dateFilters.params)
  const propostasGanhas = await scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Ganha'`, dateFilters.params)
  const valorTotalPropostas = await moneyScalar(`SELECT COALESCE(SUM(pr.valor_total), 0) ${proposalBase}`, dateFilters.params)
  const valorTotalGanho = await moneyScalar(`SELECT COALESCE(SUM(pr.valor_total), 0) ${proposalBase} AND pr.status = 'Ganha'`, dateFilters.params)

  res.json({
    concessionarias,
    produtos,
    visitas,
    propostas,
    propostas_em_andamento: await scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Em andamento'`, dateFilters.params),
    propostas_em_aberto: await scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Em aberto'`, dateFilters.params),
    propostas_ganhas: propostasGanhas,
    propostas_perdidas: await scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Perdida'`, dateFilters.params),
    taxa_propostas: visitas ? Math.round((propostas / visitas) * 100) : 0,
    taxa_conversao: propostas ? Math.round((propostasGanhas / propostas) * 100) : 0,
    valor_total_propostas: valorTotalPropostas,
    valor_total_ganho: valorTotalGanho,
    ticket_medio: propostas ? Number((valorTotalPropostas / propostas).toFixed(2)) : 0,
    proximas_calls: await scalar(
      `SELECT COUNT(*) ${proposalBase} AND pr.tem_nova_call = 1 AND pr.data_hora_proxima_call IS NOT NULL`,
      dateFilters.params,
    ),
    recentes: await listVisits({ limit: 6, ...req.query, usuario_id: req.user.id }),
  })
}))

app.get('/api/concessionarias', h(async (req, res) => {
  res.json(await all('SELECT * FROM concessionarias WHERE usuario_id = ? ORDER BY nome', [req.user.id]))
}))

app.post('/api/concessionarias', h(async (req, res) => {
  const body = dealerPayload(req.body)
  requireField(body.nome, 'Nome da concessionaria e obrigatorio')
  const result = await run(
    `INSERT INTO concessionarias
    (usuario_id, nome, grupo_economico, cnpj, endereco, cidade, uf, contato_principal, whatsapp, email)
    VALUES (@usuario_id, @nome, @grupo_economico, @cnpj, @endereco, @cidade, @uf, @contato_principal, @whatsapp, @email)`,
    { ...body, usuario_id: req.user.id },
  )
  res.status(201).json(await findOwnedById('concessionarias', result.insertId, req.user.id))
}))

app.put('/api/concessionarias/:id', h(async (req, res) => {
  await requireOwnedEntity('concessionarias', req.params.id, req.user.id, 'Concessionaria nao encontrada')
  const body = dealerPayload(req.body)
  requireField(body.nome, 'Nome da concessionaria e obrigatorio')
  await run(
    `UPDATE concessionarias SET
      nome = @nome, grupo_economico = @grupo_economico, cnpj = @cnpj, endereco = @endereco,
      cidade = @cidade, uf = @uf, contato_principal = @contato_principal, whatsapp = @whatsapp,
      email = @email, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND usuario_id = @usuario_id`,
    { ...body, id: req.params.id, usuario_id: req.user.id },
  )
  res.json(await findOwnedById('concessionarias', req.params.id, req.user.id))
}))

app.delete('/api/concessionarias/:id', h(async (req, res) => {
  await requireOwnedEntity('concessionarias', req.params.id, req.user.id, 'Concessionaria nao encontrada')
  if (await scalar('SELECT COUNT(*) FROM visitas WHERE concessionaria_id = ? AND usuario_id = ?', [req.params.id, req.user.id])) {
    return res.status(409).json({ error: 'Nao e permitido excluir concessionaria com visitas cadastradas' })
  }
  await run('DELETE FROM concessionarias WHERE id = ? AND usuario_id = ?', [req.params.id, req.user.id])
  res.status(204).end()
}))

app.get('/api/produtos', h(async (req, res) => {
  res.json(await all('SELECT * FROM produtos WHERE usuario_id = ? ORDER BY nome', [req.user.id]))
}))

app.post('/api/produtos', h(async (req, res) => {
  const body = productPayload(req.body)
  requireField(body.nome, 'Nome do produto e obrigatorio')
  if (body.valor_unitario <= 0) throw badRequest('Valor unitario e obrigatorio')
  await assertUniqueName('produtos', body.nome, req.user.id, null, 'Produto ja cadastrado')
  const result = await run('INSERT INTO produtos (usuario_id, nome, valor_unitario) VALUES (@usuario_id, @nome, @valor_unitario)', {
    ...body,
    usuario_id: req.user.id,
  })
  res.status(201).json(await findOwnedById('produtos', result.insertId, req.user.id))
}))

app.put('/api/produtos/:id', h(async (req, res) => {
  await requireOwnedEntity('produtos', req.params.id, req.user.id, 'Produto nao encontrado')
  const body = productPayload(req.body)
  requireField(body.nome, 'Nome do produto e obrigatorio')
  if (body.valor_unitario <= 0) throw badRequest('Valor unitario e obrigatorio')
  await assertUniqueName('produtos', body.nome, req.user.id, req.params.id, 'Produto ja cadastrado')
  await transaction(async () => {
    const oldProduct = await findOwnedById('produtos', req.params.id, req.user.id)
    await run('UPDATE produtos SET nome = @nome, valor_unitario = @valor_unitario, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND usuario_id = @usuario_id', {
      ...body,
      id: req.params.id,
      usuario_id: req.user.id,
    })
    await syncProposalProductValues(req.params.id, oldProduct?.valor_unitario ?? 0, body.valor_unitario)
  })
  res.json(await findOwnedById('produtos', req.params.id, req.user.id))
}))

app.delete('/api/produtos/:id', h(async (req, res) => {
  await requireOwnedEntity('produtos', req.params.id, req.user.id, 'Produto nao encontrado')
  if (await scalar('SELECT COUNT(*) FROM visita_produtos vp JOIN visitas v ON v.id = vp.visita_id WHERE vp.produto_id = ? AND v.usuario_id = ?', [req.params.id, req.user.id])) {
    return res.status(409).json({ error: 'Nao e permitido excluir produto vinculado a uma visita' })
  }
  if (await scalar('SELECT COUNT(*) FROM proposta_produtos pp JOIN propostas pr ON pr.id = pp.proposta_id JOIN visitas v ON v.id = pr.visita_id WHERE pp.produto_id = ? AND v.usuario_id = ?', [req.params.id, req.user.id])) {
    return res.status(409).json({ error: 'Nao e permitido excluir produto vinculado a uma proposta' })
  }
  await run('DELETE FROM produtos WHERE id = ? AND usuario_id = ?', [req.params.id, req.user.id])
  res.status(204).end()
}))

app.get('/api/tipos-visita', h(async (req, res) => {
  res.json(await all('SELECT * FROM tipos_visita WHERE usuario_id = ? ORDER BY ativo DESC, nome', [req.user.id]))
}))

app.post('/api/tipos-visita', h(async (req, res) => {
  const body = typePayload(req.body)
  requireField(body.nome, 'Nome do tipo de visita e obrigatorio')
  await assertUniqueName('tipos_visita', body.nome, req.user.id, null, 'Tipo de visita ja cadastrado')
  const result = await run('INSERT INTO tipos_visita (usuario_id, nome, descricao, ativo) VALUES (@usuario_id, @nome, @descricao, @ativo)', {
    ...body,
    usuario_id: req.user.id,
  })
  res.status(201).json(await findOwnedById('tipos_visita', result.insertId, req.user.id))
}))

app.put('/api/tipos-visita/:id', h(async (req, res) => {
  await requireOwnedEntity('tipos_visita', req.params.id, req.user.id, 'Tipo de visita nao encontrado')
  const body = typePayload(req.body)
  requireField(body.nome, 'Nome do tipo de visita e obrigatorio')
  await assertUniqueName('tipos_visita', body.nome, req.user.id, req.params.id, 'Tipo de visita ja cadastrado')
  await run(
    `UPDATE tipos_visita SET nome = @nome, descricao = @descricao, ativo = @ativo, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND usuario_id = @usuario_id`,
    { ...body, id: req.params.id, usuario_id: req.user.id },
  )
  res.json(await findOwnedById('tipos_visita', req.params.id, req.user.id))
}))

app.delete('/api/tipos-visita/:id', h(async (req, res) => {
  await requireOwnedEntity('tipos_visita', req.params.id, req.user.id, 'Tipo de visita nao encontrado')
  if (await scalar('SELECT COUNT(*) FROM visitas WHERE tipo_visita_id = ? AND usuario_id = ?', [req.params.id, req.user.id])) {
    await run('UPDATE tipos_visita SET ativo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ?', [req.params.id, req.user.id])
    return res.json({
      message: 'Tipo de visita possui visitas vinculadas e foi desativado em vez de excluido',
      item: await findOwnedById('tipos_visita', req.params.id, req.user.id),
    })
  }
  await run('DELETE FROM tipos_visita WHERE id = ? AND usuario_id = ?', [req.params.id, req.user.id])
  res.status(204).end()
}))

app.get('/api/visitas', h(async (req, res) => {
  res.json(await listVisits({ ...req.query, usuario_id: req.user.id }))
}))

app.get('/api/visitas/:id/calendario', h(async (req, res) => {
  const visit = (await listVisits({ id: req.params.id, usuario_id: req.user.id }))[0]
  if (!visit) throw badRequest('Visita nao encontrada')
  if (!visit.data_proxima_reuniao || !visit.hora_proxima_reuniao) throw badRequest('Informe data e hora da proxima reuniao')
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="visita-facil-reuniao-${visit.id}.ics"`)
  res.send(buildCalendarInvite(visit))
}))

app.post('/api/visitas', h(async (req, res) => {
  const result = await saveVisit(req.body, null, req.user.id)
  res.status(201).json({ ...(await listVisits({ id: result.id, usuario_id: req.user.id }))[0], warning: result.warning })
}))

app.put('/api/visitas/:id', h(async (req, res) => {
  const result = await saveVisit(req.body, Number(req.params.id), req.user.id)
  res.json({ ...(await listVisits({ id: result.id, usuario_id: req.user.id }))[0], warning: result.warning })
}))

app.delete('/api/visitas/:id', h(async (req, res) => {
  await requireOwnedVisit(req.params.id, req.user.id)
  await transaction(async () => {
    await run('DELETE FROM visita_produtos WHERE visita_id = ?', [req.params.id])
    await run('DELETE FROM visitas WHERE id = ?', [req.params.id])
  })
  res.status(204).end()
}))

app.get('/api/propostas', h(async (req, res) => {
  res.json(await listProposals({ ...req.query, usuario_id: req.user.id }))
}))

app.get('/api/propostas/:id', h(async (req, res) => {
  const proposal = (await listProposals({ id: req.params.id, usuario_id: req.user.id }))[0]
  if (!proposal) throw badRequest('Proposta nao encontrada')
  res.json({ ...proposal, itens: await proposalItems(req.params.id) })
}))

app.put('/api/propostas/:id', h(async (req, res) => {
  await requireOwnedProposal(req.params.id, req.user.id)
  await saveProposal(req.params.id, req.body)
  res.json({ ...(await listProposals({ id: req.params.id, usuario_id: req.user.id }))[0], itens: await proposalItems(req.params.id) })
}))

app.delete('/api/propostas/:id', h(async (req, res) => {
  await requireOwnedProposal(req.params.id, req.user.id)
  await run('DELETE FROM propostas WHERE id = ?', [req.params.id])
  res.status(204).end()
}))

app.use((error, _req, res, _next) => {
  const status = error.status || 500
  if (status >= 500) console.error(error)
  res.status(status).json({ error: error.message || 'Erro interno' })
})

app.listen(port, () => {
  console.log(`API Visita Facil em http://localhost:${port} usando MySQL ${dbName}`)
})

async function initDb() {
  const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined
  const baseConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    dateStrings: true,
    ssl,
  }

  const setup = await mysql.createConnection(baseConfig)
  await setup.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await setup.end()

  pool = mysql.createPool({
    ...baseConfig,
    database: dbName,
    waitForConnections: true,
    connectionLimit: 10,
  })

  if (fs.existsSync(migrationPath)) {
    const statements = fs
      .readFileSync(migrationPath, 'utf8')
      .split(/;\s*(?:\r?\n|$)/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !/^CREATE DATABASE/i.test(item) && !/^USE\s+/i.test(item))

    for (const statement of statements) {
      try {
        await pool.query(statement)
      } catch (error) {
        if (![1061, 1062].includes(error.errno)) throw error
      }
    }
  }

  await ensureMySqlSchema()
}

async function ensureMySqlSchema() {
  await ensureColumn('usuarios', 'email', 'ALTER TABLE usuarios ADD COLUMN email VARCHAR(255) NULL AFTER login')
  await ensureIndex('usuarios', 'idx_usuarios_email', 'CREATE UNIQUE INDEX idx_usuarios_email ON usuarios(email)')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recuperacoes_senha (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_recuperacoes_senha_usuarios FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE,
      INDEX idx_recuperacoes_senha_usuario (usuario_id),
      INDEX idx_recuperacoes_senha_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

async function ensureColumn(table, column, ddl) {
  const existing = await get(
    `SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, table, column],
  )
  if (!existing) await pool.query(ddl)
}

async function ensureIndex(table, indexName, ddl) {
  const existing = await get(
    `SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
    LIMIT 1`,
    [dbName, table, indexName],
  )
  if (!existing) await pool.query(ddl)
}

async function listVisits(filters = {}) {
  const where = []
  const params = {}

  if (filters.id) addWhere(where, params, 'v.id = @id', 'id', filters.id)
  if (filters.usuario_id) addWhere(where, params, 'v.usuario_id = @usuario_id', 'usuario_id', filters.usuario_id)
  if (filters.concessionaria_id) addWhere(where, params, 'v.concessionaria_id = @concessionaria_id', 'concessionaria_id', filters.concessionaria_id)
  if (filters.grupo_economico) addWhere(where, params, 'c.grupo_economico = @grupo_economico', 'grupo_economico', filters.grupo_economico)
  if (filters.tipo_visita_id) addWhere(where, params, 'v.tipo_visita_id = @tipo_visita_id', 'tipo_visita_id', filters.tipo_visita_id)
  if (filters.produto_id) addWhere(where, params, 'EXISTS (SELECT 1 FROM visita_produtos vp2 WHERE vp2.visita_id = v.id AND vp2.produto_id = @produto_id)', 'produto_id', filters.produto_id)
  if (filters.data_inicial) addWhere(where, params, 'v.data_visita >= @data_inicial', 'data_inicial', filters.data_inicial)
  if (filters.data_final) addWhere(where, params, 'v.data_visita <= @data_final', 'data_final', filters.data_final)
  if (filters.gerou_proposta === '0' || filters.gerou_proposta === '1') addWhere(where, params, 'v.gerou_proposta = @gerou_proposta', 'gerou_proposta', filters.gerou_proposta)
  if (filters.limit) params.limit = Number(filters.limit)

  return all(
    `SELECT
      v.*,
      c.nome AS concessionaria,
      c.grupo_economico,
      t.nome AS tipo_visita,
      pr.id AS proposta_id,
      COALESCE(GROUP_CONCAT(p.nome SEPARATOR ', '), '') AS produtos,
      COALESCE(GROUP_CONCAT(p.id), '') AS produto_ids
    FROM visitas v
    JOIN concessionarias c ON c.id = v.concessionaria_id
    JOIN tipos_visita t ON t.id = v.tipo_visita_id
    LEFT JOIN propostas pr ON pr.visita_id = v.id
    LEFT JOIN visita_produtos vp ON vp.visita_id = v.id
    LEFT JOIN produtos p ON p.id = vp.produto_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY v.id
    ORDER BY v.data_visita DESC, v.id DESC
    ${filters.limit ? 'LIMIT @limit' : ''}`,
    params,
  )
}

async function listProposals(filters = {}) {
  const where = []
  const params = {}

  if (filters.id) addWhere(where, params, 'pr.id = @id', 'id', filters.id)
  if (filters.usuario_id) addWhere(where, params, 'v.usuario_id = @usuario_id', 'usuario_id', filters.usuario_id)
  if (filters.concessionaria_id) addWhere(where, params, 'v.concessionaria_id = @concessionaria_id', 'concessionaria_id', filters.concessionaria_id)
  if (filters.grupo_economico) addWhere(where, params, 'c.grupo_economico = @grupo_economico', 'grupo_economico', filters.grupo_economico)
  if (filters.tipo_visita_id) addWhere(where, params, 'v.tipo_visita_id = @tipo_visita_id', 'tipo_visita_id', filters.tipo_visita_id)
  if (filters.produto_id) addWhere(where, params, 'EXISTS (SELECT 1 FROM proposta_produtos pp2 WHERE pp2.proposta_id = pr.id AND pp2.produto_id = @produto_id)', 'produto_id', filters.produto_id)
  if (filters.status) addWhere(where, params, 'pr.status = @status', 'status', filters.status)
  if (filters.data_inicial) addWhere(where, params, 'v.data_visita >= @data_inicial', 'data_inicial', filters.data_inicial)
  if (filters.data_final) addWhere(where, params, 'v.data_visita <= @data_final', 'data_final', filters.data_final)
  if (filters.proxima_call === '1') where.push('pr.tem_nova_call = 1 AND pr.data_hora_proxima_call IS NOT NULL')
  if (filters.abertas === '1') where.push("pr.status IN ('Em andamento', 'Em aberto')")
  if (filters.ganhas === '1') where.push("pr.status = 'Ganha'")
  if (filters.perdidas === '1') where.push("pr.status = 'Perdida'")

  return all(
    `SELECT
      pr.*,
      v.id AS visita_id,
      v.data_visita,
      v.observacao AS observacao_visita,
      c.nome AS concessionaria,
      c.grupo_economico,
      t.nome AS tipo_visita,
      COALESCE(GROUP_CONCAT(p.nome SEPARATOR ', '), '') AS produtos,
      COALESCE(GROUP_CONCAT(p.id), '') AS produto_ids
    FROM propostas pr
    JOIN visitas v ON v.id = pr.visita_id
    JOIN concessionarias c ON c.id = v.concessionaria_id
    JOIN tipos_visita t ON t.id = v.tipo_visita_id
    LEFT JOIN proposta_produtos pp ON pp.proposta_id = pr.id
    LEFT JOIN produtos p ON p.id = pp.produto_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY pr.id
    ORDER BY v.data_visita DESC, pr.id DESC`,
    params,
  )
}

function proposalItems(proposalId) {
  return all(
    `SELECT
      pp.*,
      p.nome AS produto,
      p.valor_unitario AS valor_unitario_original
    FROM proposta_produtos pp
    JOIN produtos p ON p.id = pp.produto_id
    WHERE pp.proposta_id = ?
    ORDER BY p.nome`,
    [proposalId],
  )
}

async function saveVisit(input, visitId = null, userId) {
  const payload = visitPayload(input)
  requireField(payload.concessionaria_id, 'Concessionaria e obrigatoria')
  requireField(payload.tipo_visita_id, 'Tipo de visita e obrigatorio')
  requireField(payload.data_visita, 'Data da visita e obrigatoria')
  if (!payload.produto_ids.length) throw badRequest('Informe ao menos um produto')

  await requireOwnedEntity('concessionarias', payload.concessionaria_id, userId, 'Concessionaria nao encontrada')
  for (const productId of payload.produto_ids) {
    await requireOwnedEntity('produtos', productId, userId, 'Produto nao encontrado')
  }

  const type = await findOwnedById('tipos_visita', payload.tipo_visita_id, userId)
  if (!type) throw badRequest('Tipo de visita nao encontrado')
  if (!type.ativo) throw badRequest('Tipos de visita inativos nao podem ser usados em novas visitas')

  return transaction(async () => {
    let id = visitId
    if (id) await requireOwnedVisit(id, userId)
    const hadProposal = id ? Boolean(await findProposalByVisit(id)) : false
    const oldVisit = id ? await findById('visitas', id) : null
    let warning = ''

    if (id) {
      await run(
        `UPDATE visitas SET
          concessionaria_id = @concessionaria_id,
          tipo_visita_id = @tipo_visita_id,
          data_visita = @data_visita,
          observacao = @observacao,
          gerou_proposta = @gerou_proposta,
          data_proxima_reuniao = @data_proxima_reuniao,
          hora_proxima_reuniao = @hora_proxima_reuniao,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = @id AND usuario_id = @usuario_id`,
        { ...payload, id, usuario_id: userId },
      )
      await run('DELETE FROM visita_produtos WHERE visita_id = ?', [id])
    } else {
      const result = await run(
        `INSERT INTO visitas
        (usuario_id, concessionaria_id, tipo_visita_id, data_visita, observacao, gerou_proposta, data_proxima_reuniao, hora_proxima_reuniao)
        VALUES (@usuario_id, @concessionaria_id, @tipo_visita_id, @data_visita, @observacao, @gerou_proposta, @data_proxima_reuniao, @hora_proxima_reuniao)`,
        { ...payload, usuario_id: userId },
      )
      id = Number(result.insertId)
    }

    for (const productId of payload.produto_ids) {
      await run('INSERT INTO visita_produtos (visita_id, produto_id) VALUES (?, ?)', [id, productId])
    }

    if (payload.gerou_proposta) {
      await ensureProposalForVisit(id)
      if (hadProposal) warning = 'A visita foi atualizada, mas os dados comerciais da proposta existente foram preservados.'
    } else if (oldVisit?.gerou_proposta && hadProposal) {
      warning = 'A proposta existente foi preservada mesmo com Gerou Proposta = Nao.'
    }

    return { id, warning }
  })
}

async function ensureProposalForVisit(visitId) {
  const existing = await findProposalByVisit(visitId)
  if (existing) return existing.id

  const result = await run(
    `INSERT INTO propostas (visita_id, status, finalizada, valor_total)
    VALUES (?, 'Em andamento', 0, 0)`,
    [visitId],
  )
  const proposalId = Number(result.insertId)
  const products = await all(
    `SELECT p.id, p.valor_unitario
    FROM visita_produtos vp
    JOIN produtos p ON p.id = vp.produto_id
    WHERE vp.visita_id = ?`,
    [visitId],
  )

  for (const product of products) {
    const value = toMoney(product.valor_unitario)
    await run(
      `INSERT INTO proposta_produtos
      (proposta_id, produto_id, valor_unitario_original, valor_unitario_negociado, quantidade, valor_total_item)
      VALUES (@proposta_id, @produto_id, @valor_unitario_original, @valor_unitario_negociado, 1, @valor_total_item)`,
      {
        proposta_id: proposalId,
        produto_id: product.id,
        valor_unitario_original: value,
        valor_unitario_negociado: value,
        valor_total_item: value,
      },
    )
  }
  await recalcProposalTotal(proposalId)
  return proposalId
}

async function saveProposal(proposalId, input) {
  const current = await findById('propostas', proposalId)
  if (!current) throw badRequest('Proposta nao encontrada')
  const payload = proposalPayload(input, current)
  const itens = Array.isArray(input.itens) ? input.itens : []
  if (!itens.length) throw badRequest('A proposta precisa ter ao menos um produto')

  return transaction(async () => {
    await run(
      `UPDATE propostas SET
        status = @status,
        finalizada = @finalizada,
        observacao_proposta = @observacao_proposta,
        tem_nova_call = @tem_nova_call,
        data_hora_proxima_call = @data_hora_proxima_call,
        observacao_proxima_call = @observacao_proxima_call,
        proxima_acao = @proxima_acao,
        responsavel_followup = @responsavel_followup,
        motivo_perda = @motivo_perda,
        observacao_final = @observacao_final,
        data_finalizacao = @data_finalizacao,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id`,
      { ...payload, id: proposalId },
    )

    for (const item of itens) {
      const negotiated = toMoney(item.valor_unitario_negociado)
      const quantity = Number(item.quantidade || 0)
      if (quantity <= 0) throw badRequest('Quantidade deve ser maior que zero')
      await run(
        `UPDATE proposta_produtos SET
          valor_unitario_negociado = @valor_unitario_negociado,
          quantidade = @quantidade,
          valor_total_item = @valor_total_item,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = @id AND proposta_id = @proposta_id`,
        {
          id: item.id,
          proposta_id: proposalId,
          valor_unitario_negociado: negotiated,
          quantidade: quantity,
          valor_total_item: toMoney(negotiated * quantity),
        },
      )
    }
    await recalcProposalTotal(proposalId)
  })
}

async function recalcProposalTotal(proposalId) {
  const total = await moneyScalar('SELECT COALESCE(SUM(valor_total_item), 0) FROM proposta_produtos WHERE proposta_id = ?', [proposalId])
  await run('UPDATE propostas SET valor_total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [total, proposalId])
}

async function syncProposalProductValues(productId, oldValue, newValue) {
  const oldMoney = toMoney(oldValue)
  const newMoney = toMoney(newValue)
  const affectedProposals = await all('SELECT DISTINCT proposta_id FROM proposta_produtos WHERE produto_id = ?', [productId])

  await run(
    `UPDATE proposta_produtos SET
      valor_unitario_negociado = CASE
        WHEN ROUND(valor_unitario_negociado, 2) = ROUND(@old_value, 2) THEN @new_value
        ELSE valor_unitario_negociado
      END,
      valor_unitario_original = @new_value,
      valor_total_item = CASE
        WHEN ROUND(valor_unitario_negociado, 2) = ROUND(@old_value, 2) THEN ROUND(@new_value * quantidade, 2)
        ELSE ROUND(valor_unitario_negociado * quantidade, 2)
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE produto_id = @product_id`,
    {
      product_id: productId,
      old_value: oldMoney,
      new_value: newMoney,
    },
  )

  for (const item of affectedProposals) await recalcProposalTotal(item.proposta_id)
}

function proposalPayload(input, current) {
  const status = clean(input.status || current.status)
  if (!proposalStatuses.includes(status)) throw badRequest('Status da proposta invalido')
  const finalizada = input.finalizada ? 1 : 0
  if (finalizada && !['Ganha', 'Perdida'].includes(status)) throw badRequest('Propostas finalizadas precisam estar como Ganha ou Perdida')
  if (!finalizada && ['Ganha', 'Perdida'].includes(status)) throw badRequest('Propostas ganhas ou perdidas devem estar marcadas como finalizadas')

  return {
    status,
    finalizada,
    observacao_proposta: clean(input.observacao_proposta),
    tem_nova_call: input.tem_nova_call ? 1 : 0,
    data_hora_proxima_call: input.tem_nova_call ? clean(input.data_hora_proxima_call) : null,
    observacao_proxima_call: clean(input.observacao_proxima_call),
    proxima_acao: clean(input.proxima_acao),
    responsavel_followup: clean(input.responsavel_followup),
    motivo_perda: status === 'Perdida' ? clean(input.motivo_perda) : '',
    observacao_final: ['Ganha', 'Perdida'].includes(status) ? clean(input.observacao_final) : '',
    data_finalizacao: finalizada ? current.data_finalizacao || new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
  }
}

function dealerPayload(input) {
  return {
    nome: clean(input.nome),
    grupo_economico: clean(input.grupo_economico),
    cnpj: clean(input.cnpj),
    endereco: clean(input.endereco),
    cidade: clean(input.cidade),
    uf: clean(input.uf).toUpperCase().slice(0, 2),
    contato_principal: clean(input.contato_principal),
    whatsapp: clean(input.whatsapp),
    email: clean(input.email),
  }
}

function productPayload(input) {
  return {
    nome: clean(input.nome),
    valor_unitario: toMoney(input.valor_unitario),
  }
}

function typePayload(input) {
  return {
    nome: clean(input.nome),
    descricao: clean(input.descricao),
    ativo: input.ativo ? 1 : 0,
  }
}

function visitPayload(input) {
  return {
    concessionaria_id: Number(input.concessionaria_id),
    tipo_visita_id: Number(input.tipo_visita_id),
    data_visita: clean(input.data_visita),
    observacao: clean(input.observacao),
    gerou_proposta: input.gerou_proposta ? 1 : 0,
    data_proxima_reuniao: clean(input.data_proxima_reuniao) || null,
    hora_proxima_reuniao: clean(input.hora_proxima_reuniao) || null,
    produto_ids: Array.isArray(input.produto_ids) ? input.produto_ids.map(Number).filter(Boolean) : [],
  }
}

function addWhere(where, params, clause, key, value) {
  where.push(clause)
  params[key] = value
}

function dashboardDateFilters(query, userId) {
  const where = []
  const params = { usuario_id: userId }
  where.push('v.usuario_id = @usuario_id')
  if (query.data_inicial) addWhere(where, params, 'v.data_visita >= @data_inicial', 'data_inicial', query.data_inicial)
  if (query.data_final) addWhere(where, params, 'v.data_visita <= @data_final', 'data_final', query.data_final)
  return { where, params }
}

async function findProposalByVisit(visitId) {
  return get('SELECT * FROM propostas WHERE visita_id = ?', [visitId])
}

async function requireOwnedVisit(visitId, userId) {
  const visit = await get('SELECT id FROM visitas WHERE id = ? AND usuario_id = ?', [visitId, userId])
  if (!visit) throw badRequest('Visita nao encontrada')
  return visit
}

async function requireOwnedProposal(proposalId, userId) {
  const proposal = await get(
    `SELECT pr.id
    FROM propostas pr
    JOIN visitas v ON v.id = pr.visita_id
    WHERE pr.id = ? AND v.usuario_id = ?`,
    [proposalId, userId],
  )
  if (!proposal) throw badRequest('Proposta nao encontrada')
  return proposal
}

async function requireOwnedEntity(table, id, userId, message) {
  const item = await findOwnedById(table, id, userId)
  if (!item) throw badRequest(message)
  return item
}

function findOwnedById(table, id, userId) {
  return get(`SELECT * FROM ${table} WHERE id = ? AND usuario_id = ?`, [id, userId])
}

async function assertUniqueName(table, name, userId, currentId, message) {
  const existing = await get(`SELECT id FROM ${table} WHERE usuario_id = ? AND LOWER(nome) = LOWER(?)`, [userId, name])
  if (existing && String(existing.id) !== String(currentId || '')) throw badRequest(message)
}

function findUserByLogin(login) {
  return get('SELECT * FROM usuarios WHERE login = ?', [normalizeLogin(login)])
}

function findUserByEmail(email) {
  return get('SELECT * FROM usuarios WHERE email = ?', [normalizeLogin(email)])
}

function findUserByLoginOrEmail(value) {
  const normalized = normalizeLogin(value)
  return get('SELECT * FROM usuarios WHERE login = ? OR email = ? LIMIT 1', [normalized, normalized])
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex')
  await run('INSERT INTO sessoes (usuario_id, token) VALUES (?, ?)', [user.id, token])
  return { token, usuario: publicUser(user) }
}

function publicUser(user) {
  return { id: user.id, nome: user.nome, login: user.login, email: user.email }
}

async function requireAuth(req, res, next) {
  try {
    const token = authToken(req)
    if (!token) return res.status(401).json({ error: 'Faca login para continuar' })
    const session = await get(
      `SELECT s.token, u.*
      FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ?`,
      [token],
    )
    if (!session) return res.status(401).json({ error: 'Sessao invalida. Faca login novamente' })
    req.token = token
    req.user = session
    next()
  } catch (error) {
    next(error)
  }
}

function authToken(req) {
  const authorization = req.get('authorization') || ''
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim()
  return req.get('x-auth-token') || ''
}

function normalizeLogin(value) {
  return clean(value).toLowerCase()
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':')
  if (!salt || !hash) return false
  const test = crypto.scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return expected.length === test.length && crypto.timingSafeEqual(expected, test)
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function sendPasswordResetEmail(user, resetUrl) {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const userName = process.env.SMTP_USER
  const password = process.env.SMTP_PASSWORD
  const from = process.env.SMTP_FROM || userName

  if (!host || !from) {
    console.warn(`SMTP nao configurado. Link de recuperacao para ${user.email}: ${resetUrl}`)
    return
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: userName && password ? { user: userName, pass: password } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  })

  await transporter.sendMail({
    from,
    to: user.email,
    subject: 'Recuperacao de senha - Visita Facil',
    text: `Ola, ${user.nome}.\n\nAcesse o link abaixo para redefinir sua senha. Ele expira em 1 hora.\n\n${resetUrl}\n\nSe voce nao solicitou essa alteracao, ignore este e-mail.`,
    html: `<p>Ola, ${escapeHtml(user.nome)}.</p><p>Acesse o link abaixo para redefinir sua senha. Ele expira em 1 hora.</p><p><a href="${escapeHtml(resetUrl)}">Redefinir senha</a></p><p>Se voce nao solicitou essa alteracao, ignore este e-mail.</p>`,
  })
}

function mailErrorMessage(error) {
  if (error?.code === 'EAUTH' || error?.responseCode === 535) {
    return 'Falha ao autenticar no SMTP. Verifique usuario/senha e se o provedor permite envio SMTP para esta conta.'
  }
  return 'Falha ao enviar e-mail. Verifique as configuracoes SMTP.'
}

async function scalar(sql, params = []) {
  const row = await get(sql, params)
  return Number(Object.values(row || {})[0] || 0)
}

async function moneyScalar(sql, params = []) {
  return toMoney(await scalar(sql, params))
}

function findById(table, id) {
  return get(`SELECT * FROM ${table} WHERE id = ?`, [id])
}

async function all(sql, params = []) {
  const [rows] = await executor().execute(...bind(sql, params))
  return rows
}

async function get(sql, params = []) {
  const rows = await all(sql, params)
  return rows[0]
}

async function run(sql, params = []) {
  const [result] = await executor().execute(...bind(sql, params))
  return result
}

async function transaction(callback) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await txStorage.run(connection, callback)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function executor() {
  return txStorage.getStore() || pool
}

function bind(sql, params = []) {
  if (Array.isArray(params)) return [sql, params]
  const values = []
  const prepared = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, key) => {
    values.push(params[key])
    return '?'
  })
  return [prepared, values]
}

function h(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

function clean(value) {
  return String(value ?? '').trim()
}

function toMoney(value) {
  const parsed = Number(String(value ?? '0').replace(',', '.'))
  return Number((Number.isFinite(parsed) ? parsed : 0).toFixed(2))
}

function requireField(value, message) {
  if (!value) throw badRequest(message)
}

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function unauthorized(message) {
  const error = new Error(message)
  error.status = 401
  return error
}

function buildCalendarInvite(visit) {
  const start = toIcsDateTime(visit.data_proxima_reuniao, visit.hora_proxima_reuniao)
  const end = addOneHour(start)
  const title = escapeIcs(`Nova reuniao - ${visit.concessionaria}`)
  const description = escapeIcs(
    `Follow-up Visita Facil\\nTipo: ${visit.tipo_visita}\\nProdutos: ${visit.produtos || '-'}\\nObservacao: ${visit.observacao || '-'}`,
  )
  const uid = `visita-facil-${visit.id}@local`
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Visita Facil//Agenda Comercial//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

function toIcsDateTime(date, time) {
  return `${String(date).replaceAll('-', '')}T${String(time).replace(':', '').slice(0, 4)}00`
}

function addOneHour(icsDateTime) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(icsDateTime)
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) + 1, Number(match[5]), Number(match[6]))
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function escapeIcs(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n')
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
