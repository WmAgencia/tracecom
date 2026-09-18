-- 028: iq_audit_trail passa a ser particionada por dia (RANGE em created_at).
--
-- Contexto: o audit trail cresce ~96 MB/dia. A retencao com DELETE + VACUUM FULL e caraa;
-- com particoes diarias o descarte vira DROP PARTITION (O(1)), sempre precedido de arquivo
-- verificado pelo job `scripts/db-retention.mjs` (CRITICAL_HISTORY nunca e descartada sem dump).
--
-- Esta migration e SEGURA e conservadora:
--   * se a tabela ainda nao existe ou ja e particionada -> no-op;
--   * se a tabela tem linhas -> aborta (o operador deve rodar `node scripts/db-retention.mjs --migrate-partition`,
--     que faz o swap com lock e copia incremental, sem perder linha);
--   * se a tabela esta vazia -> converte para particionada (ambientes novos).
--
-- Nenhuma regra de trading/estrategia e alterada.

DO $do$
DECLARE
  v_kind "char";
  v_rows bigint;
  v_i int;
  v_from timestamptz;
  v_to timestamptz;
  v_name text;
BEGIN
  SELECT c.relkind INTO v_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'iq_audit_trail';

  IF v_kind IS NULL OR v_kind = 'p' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_rows FROM public.iq_audit_trail;
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'iq_audit_trail has % rows and is not partitioned; run: node scripts/db-retention.mjs --migrate-partition', v_rows;
  END IF;

  CREATE TABLE public.iq_audit_trail_p (
    LIKE public.iq_audit_trail INCLUDING DEFAULTS INCLUDING CONSTRAINTS
  ) PARTITION BY RANGE (created_at);

  ALTER TABLE public.iq_audit_trail_p ADD PRIMARY KEY (id, created_at);
  CREATE INDEX iq_audit_trail_p_correlation_idx ON public.iq_audit_trail_p (correlation_id, id);

  FOR v_i IN -2..14 LOOP
    v_from := date_trunc('day', now()) + make_interval(days => v_i);
    v_to := v_from + interval '1 day';
    v_name := 'iq_audit_trail_' || to_char(v_from, 'YYYYMMDD');
    EXECUTE format('CREATE TABLE public.%I PARTITION OF public.iq_audit_trail_p FOR VALUES FROM (%L) TO (%L)', v_name, v_from, v_to);
  END LOOP;

  CREATE TABLE public.iq_audit_trail_p_default PARTITION OF public.iq_audit_trail_p DEFAULT;

  ALTER SEQUENCE public.iq_audit_trail_id_seq OWNED BY NONE;
  ALTER TABLE public.iq_audit_trail RENAME TO iq_audit_trail_legacy;
  ALTER TABLE public.iq_audit_trail_p RENAME TO iq_audit_trail;
  DROP TABLE public.iq_audit_trail_legacy;
END
$do$;
