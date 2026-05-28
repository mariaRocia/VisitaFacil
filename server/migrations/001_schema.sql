PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessoes (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS concessionarias (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER,
  nome TEXT NOT NULL,
  grupo_economico TEXT,
  cnpj TEXT,
  endereco TEXT,
  cidade TEXT,
  uf TEXT,
  contato_principal TEXT,
  whatsapp TEXT,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER,
  nome TEXT NOT NULL,
  valor_unitario REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  UNIQUE (usuario_id, nome)
);

CREATE TABLE IF NOT EXISTS tipos_visita (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER,
  nome TEXT NOT NULL,
  descricao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  UNIQUE (usuario_id, nome)
);

CREATE TABLE IF NOT EXISTS visitas (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER,
  concessionaria_id INTEGER NOT NULL,
  tipo_visita_id INTEGER NOT NULL,
  data_visita TEXT NOT NULL,
  observacao TEXT,
  gerou_proposta INTEGER NOT NULL DEFAULT 0,
  data_proxima_reuniao TEXT,
  hora_proxima_reuniao TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (concessionaria_id) REFERENCES concessionarias(id) ON DELETE RESTRICT,
  FOREIGN KEY (tipo_visita_id) REFERENCES tipos_visita(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS visita_produtos (
  id INTEGER PRIMARY KEY,
  visita_id INTEGER NOT NULL,
  produto_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (visita_id) REFERENCES visitas(id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE RESTRICT,
  UNIQUE (visita_id, produto_id)
);

CREATE TABLE IF NOT EXISTS propostas (
  id INTEGER PRIMARY KEY,
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
  id INTEGER PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_visitas_concessionaria ON visitas(concessionaria_id);
CREATE INDEX IF NOT EXISTS idx_visitas_tipo ON visitas(tipo_visita_id);
CREATE INDEX IF NOT EXISTS idx_visitas_data ON visitas(data_visita);
CREATE INDEX IF NOT EXISTS idx_visita_produtos_produto ON visita_produtos(produto_id);
CREATE INDEX IF NOT EXISTS idx_propostas_visita ON propostas(visita_id);
CREATE INDEX IF NOT EXISTS idx_propostas_status ON propostas(status);
CREATE INDEX IF NOT EXISTS idx_proposta_produtos_produto ON proposta_produtos(produto_id);
