USE visitafacil;

ALTER TABLE produtos
  ADD COLUMN valor_unitario DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER nome;

-- A sincronizacao do valor original nas propostas e feita pela API
-- quando o valor_unitario do produto e alterado pelo sistema.

CREATE TABLE propostas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  visita_id INT NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'Em andamento',
  finalizada TINYINT(1) NOT NULL DEFAULT 0,
  valor_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  observacao_proposta TEXT,
  tem_nova_call TINYINT(1) NOT NULL DEFAULT 0,
  data_hora_proxima_call DATETIME,
  observacao_proxima_call TEXT,
  proxima_acao VARCHAR(80),
  responsavel_followup VARCHAR(255),
  motivo_perda TEXT,
  observacao_final TEXT,
  data_finalizacao DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_propostas_visitas FOREIGN KEY (visita_id) REFERENCES visitas(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE proposta_produtos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  proposta_id INT NOT NULL,
  produto_id INT NOT NULL,
  valor_unitario_original DECIMAL(10,2) NOT NULL DEFAULT 0,
  valor_unitario_negociado DECIMAL(10,2) NOT NULL DEFAULT 0,
  quantidade DECIMAL(10,2) NOT NULL DEFAULT 1,
  valor_total_item DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proposta_produtos_propostas FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_proposta_produtos_produtos FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_propostas_visita ON propostas(visita_id);
CREATE INDEX idx_propostas_status ON propostas(status);
CREATE INDEX idx_proposta_produtos_produto ON proposta_produtos(produto_id);
