import cors from 'cors'
import Database from 'better-sqlite3'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
const dbPath = path.join(dataDir, 'visitafacil.sqlite')
const migrationPath = path.join(__dirname, 'migrations', '001_schema.sql')
const port = Number(process.env.API_PORT || 3001)
const proposalStatuses = ['Em andamento', 'Em aberto', 'Ganha', 'Perdida']
const openAiModel = process.env.OPENAI_MODEL || 'gpt-5-mini'

fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')
db.exec(fs.readFileSync(migrationPath, 'utf8'))
ensureSchema()
seedBaseData()

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/dashboard', (req, res) => {
  const dateFilters = dashboardDateFilters(req.query)
  const visitWhere = dateFilters.where.length ? ` WHERE ${dateFilters.where.join(' AND ')}` : ''
  const proposalWhere = dateFilters.where.length ? ` AND ${dateFilters.where.join(' AND ')}` : ''
  const proposalBase = `FROM propostas pr JOIN visitas v ON v.id = pr.visita_id WHERE 1 = 1${proposalWhere}`
  const concessionarias = scalar('SELECT COUNT(*) FROM concessionarias')
  const produtos = scalar('SELECT COUNT(*) FROM produtos')
  const visitas = scalar(`SELECT COUNT(*) FROM visitas v${visitWhere}`, dateFilters.params)
  const propostas = scalar(`SELECT COUNT(*) ${proposalBase}`, dateFilters.params)
  const propostasGanhas = scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Ganha'`, dateFilters.params)
  const valorTotalPropostas = moneyScalar(`SELECT COALESCE(SUM(pr.valor_total), 0) ${proposalBase}`, dateFilters.params)
  const valorTotalGanho = moneyScalar(`SELECT COALESCE(SUM(pr.valor_total), 0) ${proposalBase} AND pr.status = 'Ganha'`, dateFilters.params)
  const recentes = listVisits({ limit: 6, ...req.query })

  res.json({
    concessionarias,
    produtos,
    visitas,
    propostas,
    propostas_em_andamento: scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Em andamento'`, dateFilters.params),
    propostas_em_aberto: scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Em aberto'`, dateFilters.params),
    propostas_ganhas: propostasGanhas,
    propostas_perdidas: scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Perdida'`, dateFilters.params),
    taxa_propostas: visitas ? Math.round((propostas / visitas) * 100) : 0,
    taxa_conversao: propostas ? Math.round((propostasGanhas / propostas) * 100) : 0,
    valor_total_propostas: valorTotalPropostas,
    valor_total_ganho: valorTotalGanho,
    ticket_medio: propostas ? Number((valorTotalPropostas / propostas).toFixed(2)) : 0,
    proximas_calls: scalar(
      `SELECT COUNT(*) ${proposalBase} AND pr.tem_nova_call = 1 AND pr.data_hora_proxima_call IS NOT NULL`,
      dateFilters.params,
    ),
    recentes,
  })
})

app.post('/api/ia/visita-resumo', async (req, res, next) => {
  try {
    const observacao = clean(req.body?.observacao)
    if (!observacao) throw badRequest('Informe a observacao da visita para resumir')

    const result = await callOpenAiJson({
      name: 'resumo_visita',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resumo: { type: 'string' },
          pontos_de_dor: { type: 'array', items: { type: 'string' } },
          interesses: { type: 'array', items: { type: 'string' } },
          objecoes: { type: 'array', items: { type: 'string' } },
          proximos_passos: { type: 'array', items: { type: 'string' } },
        },
        required: ['resumo', 'pontos_de_dor', 'interesses', 'objecoes', 'proximos_passos'],
      },
      instructions:
        'Voce e um assistente comercial B2B. Resuma observacoes de visitas em portugues do Brasil, com linguagem objetiva e pronta para CRM. Nao invente fatos.',
      input: `Observacao da visita:\n${observacao}`,
    })

    res.json(result)
  } catch (error) {
    next(error)
  }
})

app.get('/api/ia/dashboard-insights', async (req, res, next) => {
  try {
    const dateFilters = dashboardDateFilters(req.query)
    const proposalWhere = dateFilters.where.length ? ` AND ${dateFilters.where.join(' AND ')}` : ''
    const proposalBase = `FROM propostas pr JOIN visitas v ON v.id = pr.visita_id WHERE 1 = 1${proposalWhere}`
    const totalVisitas = scalar(
      `SELECT COUNT(*) FROM visitas v${dateFilters.where.length ? ` WHERE ${dateFilters.where.join(' AND ')}` : ''}`,
      dateFilters.params,
    )
    const totalPropostas = scalar(`SELECT COUNT(*) ${proposalBase}`, dateFilters.params)
    const abertas = scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status IN ('Em andamento', 'Em aberto')`, dateFilters.params)
    const ganhas = scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Ganha'`, dateFilters.params)
    const perdidas = scalar(`SELECT COUNT(*) ${proposalBase} AND pr.status = 'Perdida'`, dateFilters.params)
    const semCall = scalar(
      `SELECT COUNT(*) ${proposalBase} AND pr.status IN ('Em andamento', 'Em aberto') AND (pr.tem_nova_call = 0 OR pr.data_hora_proxima_call IS NULL OR pr.data_hora_proxima_call = '')`,
      dateFilters.params,
    )
    const valorTotal = moneyScalar(`SELECT COALESCE(SUM(pr.valor_total), 0) ${proposalBase}`, dateFilters.params)
    const perdasPorMotivo = db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(pr.motivo_perda), ''), 'Sem motivo informado') AS motivo, COUNT(*) AS total
        ${proposalBase} AND pr.status = 'Perdida'
        GROUP BY motivo
        ORDER BY total DESC
        LIMIT 5`,
      )
      .all(dateFilters.params)

    const result = await callOpenAiJson({
      name: 'dashboard_insights',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resumo: { type: 'string' },
          alertas: { type: 'array', items: { type: 'string' } },
          oportunidades: { type: 'array', items: { type: 'string' } },
          acoes_recomendadas: { type: 'array', items: { type: 'string' } },
        },
        required: ['resumo', 'alertas', 'oportunidades', 'acoes_recomendadas'],
      },
      instructions:
        'Voce e um analista comercial. Gere insights curtos em portugues do Brasil usando apenas os numeros fornecidos. Seja pratico e recomende acoes comerciais.',
      input: JSON.stringify({
        periodo: {
          data_inicial: clean(req.query.data_inicial),
          data_final: clean(req.query.data_final),
        },
        metricas: {
          visitas: totalVisitas,
          propostas: totalPropostas,
          abertas,
          ganhas,
          perdidas,
          taxa_propostas: totalVisitas ? Math.round((totalPropostas / totalVisitas) * 100) : 0,
          taxa_conversao: totalPropostas ? Math.round((ganhas / totalPropostas) * 100) : 0,
          propostas_abertas_sem_call: semCall,
          valor_total_propostas: valorTotal,
          ticket_medio: totalPropostas ? Number((valorTotal / totalPropostas).toFixed(2)) : 0,
        },
        perdas_por_motivo: perdasPorMotivo,
      }),
    })

    res.json(result)
  } catch (error) {
    next(error)
  }
})

app.post('/api/ia/propostas/:id/motivo-perda', async (req, res, next) => {
  try {
    const proposal = listProposals({ id: req.params.id })[0]
    if (!proposal) throw badRequest('Proposta nao encontrada')

    const result = await callOpenAiJson({
      name: 'motivo_perda',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          categoria: {
            type: 'string',
            enum: ['preco', 'timing', 'concorrente', 'falta de aderencia', 'sem retorno'],
          },
          motivo_sugerido: { type: 'string' },
          confianca: { type: 'string', enum: ['baixa', 'media', 'alta'] },
        },
        required: ['categoria', 'motivo_sugerido', 'confianca'],
      },
      instructions:
        'Voce classifica motivos de perda comercial. Escolha exatamente uma categoria permitida e escreva um motivo curto para CRM. Nao invente detalhes que nao estejam no contexto.',
      input: JSON.stringify({
        concessionaria: proposal.concessionaria,
        grupo_economico: proposal.grupo_economico,
        tipo_visita: proposal.tipo_visita,
        produtos: proposal.produtos,
        valor_total: proposal.valor_total,
        observacao_visita: proposal.observacao_visita,
        observacao_proposta: proposal.observacao_proposta,
        observacao_final_informada: clean(req.body?.observacao_final),
        motivo_perda_informado: clean(req.body?.motivo_perda),
      }),
    })

    res.json(result)
  } catch (error) {
    next(error)
  }
})

app.get('/api/concessionarias', (_req, res) => {
  res.json(db.prepare('SELECT * FROM concessionarias ORDER BY nome').all())
})

app.post('/api/concessionarias', (req, res) => {
  const body = dealerPayload(req.body)
  requireField(body.nome, 'Nome da concessionaria e obrigatorio')
  const result = db
    .prepare(
      `INSERT INTO concessionarias
      (nome, grupo_economico, cnpj, endereco, cidade, uf, contato_principal, whatsapp, email)
      VALUES (@nome, @grupo_economico, @cnpj, @endereco, @cidade, @uf, @contato_principal, @whatsapp, @email)`,
    )
    .run(body)
  res.status(201).json(findById('concessionarias', result.lastInsertRowid))
})

app.put('/api/concessionarias/:id', (req, res) => {
  const body = dealerPayload(req.body)
  requireField(body.nome, 'Nome da concessionaria e obrigatorio')
  db.prepare(
    `UPDATE concessionarias SET
      nome = @nome,
      grupo_economico = @grupo_economico,
      cnpj = @cnpj,
      endereco = @endereco,
      cidade = @cidade,
      uf = @uf,
      contato_principal = @contato_principal,
      whatsapp = @whatsapp,
      email = @email,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id`,
  ).run({ ...body, id: req.params.id })
  res.json(findById('concessionarias', req.params.id))
})

app.delete('/api/concessionarias/:id', (req, res) => {
  if (scalar('SELECT COUNT(*) FROM visitas WHERE concessionaria_id = ?', req.params.id)) {
    return res.status(409).json({ error: 'Nao e permitido excluir concessionaria com visitas cadastradas' })
  }
  db.prepare('DELETE FROM concessionarias WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

app.get('/api/produtos', (_req, res) => {
  res.json(db.prepare('SELECT * FROM produtos ORDER BY nome').all())
})

app.post('/api/produtos', (req, res) => {
  const body = productPayload(req.body)
  requireField(body.nome, 'Nome do produto e obrigatorio')
  if (body.valor_unitario <= 0) throw badRequest('Valor unitario e obrigatorio')
  const result = db.prepare('INSERT INTO produtos (nome, valor_unitario) VALUES (@nome, @valor_unitario)').run(body)
  res.status(201).json(findById('produtos', result.lastInsertRowid))
})

app.put('/api/produtos/:id', (req, res) => {
  const body = productPayload(req.body)
  requireField(body.nome, 'Nome do produto e obrigatorio')
  if (body.valor_unitario <= 0) throw badRequest('Valor unitario e obrigatorio')
  db.transaction(() => {
    const oldProduct = findById('produtos', req.params.id)
    db.prepare('UPDATE produtos SET nome = @nome, valor_unitario = @valor_unitario, updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({
      ...body,
      id: req.params.id,
    })
    syncProposalProductValues(req.params.id, oldProduct?.valor_unitario ?? 0, body.valor_unitario)
  })()
  res.json(findById('produtos', req.params.id))
})

app.delete('/api/produtos/:id', (req, res) => {
  if (scalar('SELECT COUNT(*) FROM visita_produtos WHERE produto_id = ?', req.params.id)) {
    return res.status(409).json({ error: 'Nao e permitido excluir produto vinculado a uma visita' })
  }
  if (scalar('SELECT COUNT(*) FROM proposta_produtos WHERE produto_id = ?', req.params.id)) {
    return res.status(409).json({ error: 'Nao e permitido excluir produto vinculado a uma proposta' })
  }
  db.prepare('DELETE FROM produtos WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

app.get('/api/tipos-visita', (_req, res) => {
  res.json(db.prepare('SELECT * FROM tipos_visita ORDER BY ativo DESC, nome').all())
})

app.post('/api/tipos-visita', (req, res) => {
  const body = typePayload(req.body)
  requireField(body.nome, 'Nome do tipo de visita e obrigatorio')
  const result = db.prepare('INSERT INTO tipos_visita (nome, descricao, ativo) VALUES (@nome, @descricao, @ativo)').run(body)
  res.status(201).json(findById('tipos_visita', result.lastInsertRowid))
})

app.put('/api/tipos-visita/:id', (req, res) => {
  const body = typePayload(req.body)
  requireField(body.nome, 'Nome do tipo de visita e obrigatorio')
  db.prepare(
    `UPDATE tipos_visita SET
      nome = @nome,
      descricao = @descricao,
      ativo = @ativo,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id`,
  ).run({ ...body, id: req.params.id })
  res.json(findById('tipos_visita', req.params.id))
})

app.delete('/api/tipos-visita/:id', (req, res) => {
  if (scalar('SELECT COUNT(*) FROM visitas WHERE tipo_visita_id = ?', req.params.id)) {
    db.prepare('UPDATE tipos_visita SET ativo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id)
    return res.json({
      message: 'Tipo de visita possui visitas vinculadas e foi desativado em vez de excluido',
      item: findById('tipos_visita', req.params.id),
    })
  }
  db.prepare('DELETE FROM tipos_visita WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

app.get('/api/visitas', (req, res) => {
  res.json(listVisits(req.query))
})

app.get('/api/visitas/:id/calendario', (req, res) => {
  const visit = listVisits({ id: req.params.id })[0]
  if (!visit) throw badRequest('Visita nao encontrada')
  if (!visit.data_proxima_reuniao || !visit.hora_proxima_reuniao) {
    throw badRequest('Informe data e hora da proxima reuniao')
  }

  const filename = `visita-facil-reuniao-${visit.id}.ics`
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(buildCalendarInvite(visit))
})

app.post('/api/visitas', (req, res) => {
  const result = saveVisit(req.body)
  res.status(201).json({ ...listVisits({ id: result.id })[0], warning: result.warning })
})

app.put('/api/visitas/:id', (req, res) => {
  const result = saveVisit(req.body, Number(req.params.id))
  res.json({ ...listVisits({ id: result.id })[0], warning: result.warning })
})

app.delete('/api/visitas/:id', (req, res) => {
  db.transaction((id) => {
    db.prepare('DELETE FROM visita_produtos WHERE visita_id = ?').run(id)
    db.prepare('DELETE FROM visitas WHERE id = ?').run(id)
  })(req.params.id)
  res.status(204).end()
})

app.get('/api/propostas', (req, res) => {
  res.json(listProposals(req.query))
})

app.get('/api/propostas/:id', (req, res) => {
  const proposal = listProposals({ id: req.params.id })[0]
  if (!proposal) throw badRequest('Proposta nao encontrada')
  res.json({ ...proposal, itens: proposalItems(req.params.id) })
})

app.put('/api/propostas/:id', (req, res) => {
  saveProposal(req.params.id, req.body)
  res.json({ ...listProposals({ id: req.params.id })[0], itens: proposalItems(req.params.id) })
})

app.delete('/api/propostas/:id', (req, res) => {
  db.prepare('DELETE FROM propostas WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

app.use((error, _req, res, _next) => {
  const status = error.status || 500
  res.status(status).json({ error: error.message || 'Erro interno' })
})

app.listen(port, () => {
  console.log(`API Visita Facil em http://localhost:${port}`)
})

function listVisits(filters = {}) {
  const where = []
  const params = {}

  if (filters.id) addWhere(where, params, 'v.id = @id', 'id', filters.id)
  if (filters.concessionaria_id) addWhere(where, params, 'v.concessionaria_id = @concessionaria_id', 'concessionaria_id', filters.concessionaria_id)
  if (filters.grupo_economico) addWhere(where, params, 'c.grupo_economico = @grupo_economico', 'grupo_economico', filters.grupo_economico)
  if (filters.tipo_visita_id) addWhere(where, params, 'v.tipo_visita_id = @tipo_visita_id', 'tipo_visita_id', filters.tipo_visita_id)
  if (filters.produto_id) addWhere(where, params, 'EXISTS (SELECT 1 FROM visita_produtos vp2 WHERE vp2.visita_id = v.id AND vp2.produto_id = @produto_id)', 'produto_id', filters.produto_id)
  if (filters.data_inicial) addWhere(where, params, 'v.data_visita >= @data_inicial', 'data_inicial', filters.data_inicial)
  if (filters.data_final) addWhere(where, params, 'v.data_visita <= @data_final', 'data_final', filters.data_final)
  if (filters.gerou_proposta === '0' || filters.gerou_proposta === '1') addWhere(where, params, 'v.gerou_proposta = @gerou_proposta', 'gerou_proposta', filters.gerou_proposta)

  const limit = filters.limit ? ' LIMIT @limit' : ''
  if (filters.limit) params.limit = Number(filters.limit)

  return db
    .prepare(
      `SELECT
        v.*,
        c.nome AS concessionaria,
        c.grupo_economico,
        t.nome AS tipo_visita,
        pr.id AS proposta_id,
        COALESCE(GROUP_CONCAT(p.nome, ', '), '') AS produtos,
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
      ${limit}`,
    )
    .all(params)
}

function listProposals(filters = {}) {
  const where = []
  const params = {}

  if (filters.id) addWhere(where, params, 'pr.id = @id', 'id', filters.id)
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

  return db
    .prepare(
      `SELECT
        pr.*,
        v.id AS visita_id,
        v.data_visita,
        v.observacao AS observacao_visita,
        c.nome AS concessionaria,
        c.grupo_economico,
        t.nome AS tipo_visita,
        COALESCE(GROUP_CONCAT(p.nome, ', '), '') AS produtos,
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
    )
    .all(params)
}

function proposalItems(proposalId) {
  return db
    .prepare(
      `SELECT
        pp.*,
        p.nome AS produto,
        p.valor_unitario AS valor_unitario_original
      FROM proposta_produtos pp
      JOIN produtos p ON p.id = pp.produto_id
      WHERE pp.proposta_id = ?
      ORDER BY p.nome`,
    )
    .all(proposalId)
}

function saveVisit(input, visitId = null) {
  const payload = visitPayload(input)
  requireField(payload.concessionaria_id, 'Concessionaria e obrigatoria')
  requireField(payload.tipo_visita_id, 'Tipo de visita e obrigatorio')
  requireField(payload.data_visita, 'Data da visita e obrigatoria')
  if (!payload.produto_ids.length) throw badRequest('Informe ao menos um produto')

  const type = findById('tipos_visita', payload.tipo_visita_id)
  if (!type) throw badRequest('Tipo de visita nao encontrado')
  if (!type.ativo) throw badRequest('Tipos de visita inativos nao podem ser usados em novas visitas')

  return db.transaction(() => {
    let id = visitId
    const hadProposal = id ? Boolean(findProposalByVisit(id)) : false
    const oldVisit = id ? findById('visitas', id) : null
    let warning = ''

    if (id) {
      db.prepare(
        `UPDATE visitas SET
          concessionaria_id = @concessionaria_id,
          tipo_visita_id = @tipo_visita_id,
          data_visita = @data_visita,
          observacao = @observacao,
          gerou_proposta = @gerou_proposta,
          data_proxima_reuniao = @data_proxima_reuniao,
          hora_proxima_reuniao = @hora_proxima_reuniao,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = @id`,
      ).run({ ...payload, id })
      db.prepare('DELETE FROM visita_produtos WHERE visita_id = ?').run(id)
    } else {
      const result = db
        .prepare(
          `INSERT INTO visitas
          (concessionaria_id, tipo_visita_id, data_visita, observacao, gerou_proposta, data_proxima_reuniao, hora_proxima_reuniao)
          VALUES (@concessionaria_id, @tipo_visita_id, @data_visita, @observacao, @gerou_proposta, @data_proxima_reuniao, @hora_proxima_reuniao)`,
        )
        .run(payload)
      id = Number(result.lastInsertRowid)
    }

    const insertProduct = db.prepare('INSERT INTO visita_produtos (visita_id, produto_id) VALUES (?, ?)')
    payload.produto_ids.forEach((productId) => insertProduct.run(id, productId))

    if (payload.gerou_proposta) {
      ensureProposalForVisit(id)
      if (hadProposal) {
        warning = 'A visita foi atualizada, mas os dados comerciais da proposta existente foram preservados.'
      }
    } else if (oldVisit?.gerou_proposta && hadProposal) {
      warning = 'A proposta existente foi preservada mesmo com Gerou Proposta = Nao.'
    }

    return { id, warning }
  })()
}

function ensureProposalForVisit(visitId) {
  const existing = findProposalByVisit(visitId)
  if (existing) return existing.id

  const result = db
    .prepare(
      `INSERT INTO propostas
      (visita_id, status, finalizada, valor_total)
      VALUES (?, 'Em andamento', 0, 0)`,
    )
    .run(visitId)
  const proposalId = Number(result.lastInsertRowid)

  const products = db
    .prepare(
      `SELECT p.id, p.valor_unitario
      FROM visita_produtos vp
      JOIN produtos p ON p.id = vp.produto_id
      WHERE vp.visita_id = ?`,
    )
    .all(visitId)

  const insert = db.prepare(
    `INSERT INTO proposta_produtos
    (proposta_id, produto_id, valor_unitario_original, valor_unitario_negociado, quantidade, valor_total_item)
    VALUES (@proposta_id, @produto_id, @valor_unitario_original, @valor_unitario_negociado, 1, @valor_total_item)`,
  )
  products.forEach((product) => {
    const value = toMoney(product.valor_unitario)
    insert.run({
      proposta_id: proposalId,
      produto_id: product.id,
      valor_unitario_original: value,
      valor_unitario_negociado: value,
      valor_total_item: value,
    })
  })
  recalcProposalTotal(proposalId)
  return proposalId
}

function saveProposal(proposalId, input) {
  const current = findById('propostas', proposalId)
  if (!current) throw badRequest('Proposta nao encontrada')
  const payload = proposalPayload(input, current)
  const itens = Array.isArray(input.itens) ? input.itens : []
  if (!itens.length) throw badRequest('A proposta precisa ter ao menos um produto')

  return db.transaction(() => {
    db.prepare(
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
    ).run({ ...payload, id: proposalId })

    const updateItem = db.prepare(
      `UPDATE proposta_produtos SET
        valor_unitario_negociado = @valor_unitario_negociado,
        quantidade = @quantidade,
        valor_total_item = @valor_total_item,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id AND proposta_id = @proposta_id`,
    )

    itens.forEach((item) => {
      const negotiated = toMoney(item.valor_unitario_negociado)
      const quantity = Number(item.quantidade || 0)
      if (quantity <= 0) throw badRequest('Quantidade deve ser maior que zero')
      updateItem.run({
        id: item.id,
        proposta_id: proposalId,
        valor_unitario_negociado: negotiated,
        quantidade: quantity,
        valor_total_item: toMoney(negotiated * quantity),
      })
    })
    recalcProposalTotal(proposalId)
  })()
}

function recalcProposalTotal(proposalId) {
  const total = moneyScalar('SELECT COALESCE(SUM(valor_total_item), 0) FROM proposta_produtos WHERE proposta_id = ?', proposalId)
  db.prepare('UPDATE propostas SET valor_total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(total, proposalId)
}

function syncProposalProductValues(productId, oldValue, newValue) {
  const oldMoney = toMoney(oldValue)
  const newMoney = toMoney(newValue)
  const affectedProposals = db
    .prepare('SELECT DISTINCT proposta_id FROM proposta_produtos WHERE produto_id = ?')
    .all(productId)

  db.prepare(
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
  ).run({
    product_id: productId,
    old_value: oldMoney,
    new_value: newMoney,
  })

  affectedProposals.forEach((item) => recalcProposalTotal(item.proposta_id))
}

function proposalPayload(input, current) {
  const status = clean(input.status || current.status)
  if (!proposalStatuses.includes(status)) throw badRequest('Status da proposta invalido')
  const finalizada = input.finalizada ? 1 : 0
  if (finalizada && !['Ganha', 'Perdida'].includes(status)) {
    throw badRequest('Propostas finalizadas precisam estar como Ganha ou Perdida')
  }
  if (!finalizada && ['Ganha', 'Perdida'].includes(status)) {
    throw badRequest('Propostas ganhas ou perdidas devem estar marcadas como finalizadas')
  }

  return {
    status,
    finalizada,
    observacao_proposta: clean(input.observacao_proposta),
    tem_nova_call: input.tem_nova_call ? 1 : 0,
    data_hora_proxima_call: input.tem_nova_call ? clean(input.data_hora_proxima_call) : '',
    observacao_proxima_call: clean(input.observacao_proxima_call),
    proxima_acao: clean(input.proxima_acao),
    responsavel_followup: clean(input.responsavel_followup),
    motivo_perda: status === 'Perdida' ? clean(input.motivo_perda) : '',
    observacao_final: ['Ganha', 'Perdida'].includes(status) ? clean(input.observacao_final) : '',
    data_finalizacao: finalizada ? current.data_finalizacao || new Date().toISOString() : '',
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
    data_proxima_reuniao: clean(input.data_proxima_reuniao),
    hora_proxima_reuniao: clean(input.hora_proxima_reuniao),
    produto_ids: Array.isArray(input.produto_ids) ? input.produto_ids.map(Number).filter(Boolean) : [],
  }
}

function ensureSchema() {
  ensureColumn('produtos', 'valor_unitario', 'ALTER TABLE produtos ADD COLUMN valor_unitario REAL NOT NULL DEFAULT 0')
  ensureColumn('visitas', 'data_proxima_reuniao', 'ALTER TABLE visitas ADD COLUMN data_proxima_reuniao TEXT')
  ensureColumn('visitas', 'hora_proxima_reuniao', 'ALTER TABLE visitas ADD COLUMN hora_proxima_reuniao TEXT')
  db.exec(`
    CREATE TABLE IF NOT EXISTS propostas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visita_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'Em andamento',
      finalizada INTEGER NOT NULL DEFAULT 0,
      valor_total REAL NOT NULL DEFAULT 0,
      observacao_proposta TEXT,
      tem_nova_call INTEGER NOT NULL DEFAULT 0,
      data_hora_proxima_call TEXT,
      observacao_proxima_call TEXT,
      proxima_acao TEXT,
      responsavel_followup TEXT,
      motivo_perda TEXT,
      observacao_final TEXT,
      data_finalizacao TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (visita_id) REFERENCES visitas(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS proposta_produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposta_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      valor_unitario_original REAL NOT NULL DEFAULT 0,
      valor_unitario_negociado REAL NOT NULL DEFAULT 0,
      quantidade REAL NOT NULL DEFAULT 1,
      valor_total_item REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE CASCADE,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_propostas_visita ON propostas(visita_id);
    CREATE INDEX IF NOT EXISTS idx_propostas_status ON propostas(status);
    CREATE INDEX IF NOT EXISTS idx_proposta_produtos_produto ON proposta_produtos(produto_id);
  `)
}

function ensureColumn(table, column, sql) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name)
  if (!columns.includes(column)) db.prepare(sql).run()
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

function seedBaseData() {
  const seeds = [
    ['Visita Comercial', 'Primeiro contato ou visita de relacionamento comercial'],
    ['Follow-up', 'Retorno para acompanhar oportunidades em andamento'],
    ['Pos-venda', 'Acompanhamento apos a venda'],
    ['Demonstracao', 'Apresentacao pratica de produto ou solucao'],
    ['Treinamento', 'Capacitacao da equipe da concessionaria'],
    ['Reuniao Estrategica', 'Discussao de plano comercial e proximos passos'],
  ]

  const insert = db.prepare('INSERT OR IGNORE INTO tipos_visita (nome, descricao, ativo) VALUES (?, ?, 1)')
  seeds.forEach((seed) => insert.run(seed[0], seed[1]))
}

function addWhere(where, params, clause, key, value) {
  where.push(clause)
  params[key] = value
}

function dashboardDateFilters(query) {
  const where = []
  const params = {}
  if (query.data_inicial) addWhere(where, params, 'v.data_visita >= @data_inicial', 'data_inicial', query.data_inicial)
  if (query.data_final) addWhere(where, params, 'v.data_visita <= @data_final', 'data_final', query.data_final)
  return { where, params }
}

function findProposalByVisit(visitId) {
  return db.prepare('SELECT * FROM propostas WHERE visita_id = ?').get(visitId)
}

function scalar(sql, ...params) {
  return Number(db.prepare(sql).pluck().get(...params) || 0)
}

function moneyScalar(sql, ...params) {
  return toMoney(db.prepare(sql).pluck().get(...params) || 0)
}

function findById(table, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
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

async function callOpenAiJson({ name, schema, instructions, input }) {
  if (!process.env.OPENAI_API_KEY) {
    throw Object.assign(new Error('Configure OPENAI_API_KEY para usar os recursos de IA'), { status: 503 })
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: openAiModel,
      instructions,
      input,
      max_output_tokens: 900,
      text: {
        format: {
          type: 'json_schema',
          name,
          strict: true,
          schema,
        },
      },
    }),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body?.error?.message || 'Nao foi possivel gerar resposta da IA'
    throw Object.assign(new Error(message), { status: response.status >= 500 ? 502 : response.status })
  }

  const text = extractOpenAiText(body)
  if (!text) throw Object.assign(new Error('A IA nao retornou conteudo'), { status: 502 })

  try {
    return JSON.parse(text)
  } catch {
    throw Object.assign(new Error('A IA retornou um formato invalido'), { status: 502 })
  }
}

function extractOpenAiText(response) {
  if (typeof response.output_text === 'string') return response.output_text
  const parts = []
  ;(response.output || []).forEach((item) => {
    ;(item.content || []).forEach((content) => {
      if (content.type === 'output_text' && content.text) parts.push(content.text)
    })
  })
  return parts.join('').trim()
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
