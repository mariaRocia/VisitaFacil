CREATE DATABASE IF NOT EXISTS visitafacil
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE visitafacil;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  login VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255),
  senha_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessoes_usuarios FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recuperacoes_senha (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_recuperacoes_senha_usuarios FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS concessionarias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT,
  nome VARCHAR(255) NOT NULL,
  grupo_economico VARCHAR(255),
  cnpj VARCHAR(30),
  endereco VARCHAR(255),
  cidade VARCHAR(120),
  uf CHAR(2),
  contato_principal VARCHAR(255),
  whatsapp VARCHAR(30),
  email VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_concessionarias_usuarios FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS produtos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT,
  nome VARCHAR(255) NOT NULL,
  valor_unitario DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_produtos_usuarios FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uq_produtos_usuario_nome (usuario_id, nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tipos_visita (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tipos_visita_usuarios FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uq_tipos_visita_usuario_nome (usuario_id, nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visitas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT,
  concessionaria_id INT NOT NULL,
  tipo_visita_id INT NOT NULL,
  data_visita DATE NOT NULL,
  observacao TEXT,
  gerou_proposta TINYINT(1) NOT NULL DEFAULT 0,
  data_proxima_reuniao DATE,
  hora_proxima_reuniao TIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitas_usuarios FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_visitas_concessionarias FOREIGN KEY (concessionaria_id) REFERENCES concessionarias(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_visitas_tipos_visita FOREIGN KEY (tipo_visita_id) REFERENCES tipos_visita(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visita_produtos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  visita_id INT NOT NULL,
  produto_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_visita_produtos_visitas FOREIGN KEY (visita_id) REFERENCES visitas(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_visita_produtos_produtos FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE KEY uq_visita_produto (visita_id, produto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS propostas (
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

CREATE TABLE IF NOT EXISTS proposta_produtos (
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

CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);
CREATE INDEX idx_recuperacoes_senha_usuario ON recuperacoes_senha(usuario_id);
CREATE INDEX idx_recuperacoes_senha_expires ON recuperacoes_senha(expires_at);
CREATE INDEX idx_concessionarias_usuario ON concessionarias(usuario_id);
CREATE INDEX idx_produtos_usuario ON produtos(usuario_id);
CREATE INDEX idx_tipos_visita_usuario ON tipos_visita(usuario_id);
CREATE INDEX idx_visitas_usuario ON visitas(usuario_id);
CREATE INDEX idx_visitas_concessionaria ON visitas(concessionaria_id);
CREATE INDEX idx_visitas_tipo ON visitas(tipo_visita_id);
CREATE INDEX idx_visitas_data ON visitas(data_visita);
CREATE INDEX idx_visita_produtos_produto ON visita_produtos(produto_id);
CREATE INDEX idx_propostas_visita ON propostas(visita_id);
CREATE INDEX idx_propostas_status ON propostas(status);
CREATE INDEX idx_proposta_produtos_produto ON proposta_produtos(produto_id);


