-- Mantido por compatibilidade com a aba aberta anteriormente.
-- Para a nova funcionalidade completa de propostas, execute:
-- server/migrations/002_add_propostas.mysql.sql

USE visitafacil;

ALTER TABLE visitas
  ADD COLUMN data_proxima_reuniao DATE NULL AFTER gerou_proposta,
  ADD COLUMN hora_proxima_reuniao TIME NULL AFTER data_proxima_reuniao;
